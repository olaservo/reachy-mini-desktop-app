import { useState, useEffect, useCallback, useRef } from 'react';
import { useActiveRobotContext } from '../../context';

type TimeoutId = ReturnType<typeof setTimeout>;

interface VolumeApiResponse {
  volume?: number;
  device?: string | null;
  platform?: string | null;
}

/**
 * One selectable audio endpoint as reported by `/api/audio-devices/{output,input}`.
 *
 * Devices are keyed by `name`, deliberately: an ALSA card index shifts as USB
 * devices come and go, the name is stable across replug and reboot.
 *
 * `aec` is true only for the built-in card. Echo cancellation on Reachy Mini is
 * done in hardware by the XMOS chip, which needs to drive the speaker itself to
 * have an AEC reference — so any external output silently loses it. The UI
 * surfaces that rather than letting it be a surprise mid-conversation.
 */
export interface AudioDevice {
  name: string;
  aec: boolean;
}

interface AudioDeviceListResponse {
  devices?: AudioDevice[];
}

/** Reply from `/api/audio-devices/{output,input}/selected`; null means no explicit selection. */
interface SelectedDeviceResponse {
  device_name?: string | null;
}

export type AudioDeviceScope = 'output' | 'input';

export interface UseAudioControlsResult {
  volume: number;
  microphoneVolume: number;
  speakerDevice: string | null;
  microphoneDevice: string | null;
  speakerPlatform: string | null;
  microphonePlatform: string | null;
  /**
   * Persisted device selection, from `/api/audio-devices/{output,input}/selected`.
   *
   * Distinct from `speakerDevice`/`microphoneDevice`, which report the sink the
   * daemon is driving right now. The two diverge while a selection is being
   * applied — the pipeline rebuild leaves the old sink live for a moment — and
   * when the selected device is gone and playback has fallen back to built-in.
   * The dropdown must follow the selection, not the live sink.
   */
  selectedOutputDevice: string | null;
  selectedInputDevice: string | null;
  handleVolumeChange: (newVolume: number) => void;
  handleMicrophoneChange: (enabled: boolean) => void;
  handleMicrophoneVolumeChange: (newVolume: number) => void;
  handleSpeakerMute: () => void;
  handleMicrophoneMute: () => void;
  /** False when the daemon has no audio-devices router (404) — UI stays read-only. */
  deviceSelectionSupported: boolean;
  outputDevices: AudioDevice[];
  inputDevices: AudioDevice[];
  devicesLoading: boolean;
  /** Which scope is mid-switch, so the UI can block further input during the rebuild. */
  applyingDevice: AudioDeviceScope | null;
  refreshAudioDevices: (scope: AudioDeviceScope) => void;
  handleSpeakerDeviceChange: (deviceName: string) => void;
  handleMicrophoneDeviceChange: (deviceName: string) => void;
}

/**
 * Hook to manage audio controls (speaker and microphone)
 * Handles volume state, device info, and API calls
 *
 * Uses API config from ActiveRobotContext for decoupling
 */
export function useAudioControls(isActive: boolean): UseAudioControlsResult {
  const { api } = useActiveRobotContext();
  const { buildApiUrl, fetchWithTimeout, config } = api;
  const DAEMON_CONFIG = config as {
    TIMEOUTS: { VERSION: number; AUDIO_DEVICE_SWITCH: number };
  };

  const [volume, setVolume] = useState<number>(50);
  const [microphoneVolume, setMicrophoneVolume] = useState<number>(50);

  const [speakerDevice, setSpeakerDevice] = useState<string | null>(null);
  const [microphoneDevice, setMicrophoneDevice] = useState<string | null>(null);
  const [speakerPlatform, setSpeakerPlatform] = useState<string | null>(null);
  const [microphonePlatform, setMicrophonePlatform] = useState<string | null>(null);

  const [selectedOutputDevice, setSelectedOutputDevice] = useState<string | null>(null);
  const [selectedInputDevice, setSelectedInputDevice] = useState<string | null>(null);

  const [outputDevices, setOutputDevices] = useState<AudioDevice[]>([]);
  const [inputDevices, setInputDevices] = useState<AudioDevice[]>([]);
  const [deviceSelectionSupported, setDeviceSelectionSupported] = useState<boolean>(false);
  const [devicesLoading, setDevicesLoading] = useState<boolean>(false);
  const [applyingDevice, setApplyingDevice] = useState<AudioDeviceScope | null>(null);

  const volumeDebounceTimeoutRef = useRef<TimeoutId | null>(null);
  const microphoneDebounceTimeoutRef = useRef<TimeoutId | null>(null);
  // Guards against overlapping selects. Each enumeration/selection cycle churns
  // the audio graph, and concurrent cycles can tear down an active A2DP link.
  const deviceSwitchInFlightRef = useRef<boolean>(false);

  const fetchVolumeValue = useCallback(
    async (
      endpoint: string,
      setter: (value: number) => void,
      deviceSetter: ((value: string) => void) | null,
      platformSetter: ((value: string) => void) | null,
      label: string
    ): Promise<void> => {
      try {
        const response = await fetchWithTimeout(
          buildApiUrl(endpoint),
          {},
          DAEMON_CONFIG.TIMEOUTS.VERSION,
          { silent: true }
        );
        if (response.ok) {
          const data = (await response.json()) as VolumeApiResponse;
          if (data.volume !== undefined) {
            setter(data.volume);
          }
          if (deviceSetter && data.device) {
            deviceSetter(data.device);
          }
          if (platformSetter && data.platform) {
            platformSetter(data.platform);
          }
        }
      } catch (err) {
        console.warn(`Failed to fetch ${label}:`, err);
      }
    },
    []
  );

  /** Re-read volume + device label for one scope. Volume follows the selected sink. */
  const refreshVolumeState = useCallback(
    (scope: AudioDeviceScope): void => {
      if (scope === 'output') {
        fetchVolumeValue(
          '/api/volume/current',
          setVolume,
          setSpeakerDevice,
          setSpeakerPlatform,
          'volume'
        );
      } else {
        fetchVolumeValue(
          '/api/volume/microphone/current',
          setMicrophoneVolume,
          setMicrophoneDevice,
          setMicrophonePlatform,
          'microphone volume'
        );
      }
    },
    [fetchVolumeValue]
  );

  useEffect(() => {
    if (!isActive) return;
    refreshVolumeState('output');
    refreshVolumeState('input');
  }, [isActive, refreshVolumeState]);

  /**
   * Load the selectable devices for one scope.
   *
   * A 404 means the daemon predates the audio-devices router: we latch
   * `deviceSelectionSupported` to false and the UI keeps the read-only label,
   * so this is safe to run against a stock daemon.
   */
  const refreshAudioDevices = useCallback(async (scope: AudioDeviceScope): Promise<void> => {
    const endpoint = scope === 'output' ? '/api/audio-devices/output' : '/api/audio-devices/input';
    setDevicesLoading(true);
    try {
      const response = await fetchWithTimeout(
        buildApiUrl(endpoint),
        {},
        DAEMON_CONFIG.TIMEOUTS.VERSION,
        { silent: true }
      );
      if (response.status === 404) {
        setDeviceSelectionSupported(false);
        return;
      }
      if (!response.ok) {
        console.warn(`Failed to list ${scope} audio devices:`, response.status);
        return;
      }
      const data = (await response.json()) as AudioDeviceListResponse;
      const devices = Array.isArray(data.devices) ? data.devices : [];
      setDeviceSelectionSupported(true);
      if (scope === 'output') {
        setOutputDevices(devices);
      } else {
        setInputDevices(devices);
      }
    } catch (err) {
      console.warn(`Failed to list ${scope} audio devices:`, err);
    } finally {
      setDevicesLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isActive) return;
    refreshAudioDevices('output');
    refreshAudioDevices('input');
  }, [isActive, refreshAudioDevices]);

  const applySelected = useCallback((scope: AudioDeviceScope, name: string | null): void => {
    if (scope === 'output') {
      setSelectedOutputDevice(name);
    } else {
      setSelectedInputDevice(name);
    }
  }, []);

  /** Re-read the persisted selection for one scope. Silent on stock daemons (404). */
  const refreshSelectedDevice = useCallback(
    async (scope: AudioDeviceScope): Promise<void> => {
      const endpoint =
        scope === 'output'
          ? '/api/audio-devices/output/selected'
          : '/api/audio-devices/input/selected';
      try {
        const response = await fetchWithTimeout(
          buildApiUrl(endpoint),
          {},
          DAEMON_CONFIG.TIMEOUTS.VERSION,
          { silent: true }
        );
        if (!response.ok) return;
        const data = (await response.json()) as SelectedDeviceResponse;
        applySelected(scope, data.device_name ?? null);
      } catch (err) {
        console.warn(`Failed to read selected ${scope} audio device:`, err);
      }
    },
    [applySelected]
  );

  useEffect(() => {
    if (!isActive) return;
    refreshSelectedDevice('output');
    refreshSelectedDevice('input');
  }, [isActive, refreshSelectedDevice]);

  /**
   * Select a device for one scope, or clear the selection when `deviceName` is
   * empty (which reverts to the built-in default and restores hardware AEC).
   *
   * Deliberately a *single* request with no retry on failure: each
   * enumeration/selection cycle churns the audio graph, so retrying a failed
   * select makes things worse rather than better. On failure we re-read the
   * real state instead and let the user decide.
   */
  const applyDeviceSelection = useCallback(
    async (scope: AudioDeviceScope, deviceName: string): Promise<void> => {
      if (deviceSwitchInFlightRef.current) return;
      deviceSwitchInFlightRef.current = true;
      setApplyingDevice(scope);

      const endpoint =
        scope === 'output'
          ? '/api/audio-devices/output/selected'
          : '/api/audio-devices/input/selected';
      const clearing = deviceName === '';

      try {
        const response = await fetchWithTimeout(
          buildApiUrl(endpoint),
          clearing
            ? { method: 'DELETE' }
            : {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ device_name: deviceName }),
              },
          DAEMON_CONFIG.TIMEOUTS.AUDIO_DEVICE_SWITCH,
          {
            silent: false,
            label: clearing
              ? `Clear ${scope} audio device`
              : `Select ${scope} audio device "${deviceName}"`,
          }
        );
        if (!response.ok) {
          console.warn(`Failed to select ${scope} audio device:`, response.status);
        } else {
          // Both verbs reply with the stored selection. Take it from the reply
          // rather than re-reading the live sink, which still names the old
          // device until the pipeline rebuild finishes.
          const data = (await response.json()) as SelectedDeviceResponse;
          applySelected(scope, data.device_name ?? null);
        }
      } catch (err) {
        console.warn(`Failed to select ${scope} audio device:`, err);
      } finally {
        deviceSwitchInFlightRef.current = false;
        setApplyingDevice(null);
        // Re-read regardless of outcome: the daemon is the source of truth for
        // what is actually selected, and the volume tracks the new sink.
        refreshSelectedDevice(scope);
        refreshVolumeState(scope);
        refreshAudioDevices(scope);
      }
    },
    [refreshVolumeState, refreshAudioDevices, refreshSelectedDevice, applySelected]
  );

  const handleSpeakerDeviceChange = useCallback(
    (deviceName: string): void => {
      applyDeviceSelection('output', deviceName);
    },
    [applyDeviceSelection]
  );

  const handleMicrophoneDeviceChange = useCallback(
    (deviceName: string): void => {
      applyDeviceSelection('input', deviceName);
    },
    [applyDeviceSelection]
  );

  const updateVolumeInApi = useCallback(async (newVolume: number): Promise<void> => {
    try {
      const response = await fetchWithTimeout(
        buildApiUrl('/api/volume/set'),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ volume: newVolume }),
        },
        DAEMON_CONFIG.TIMEOUTS.VERSION,
        { silent: false, label: `Set volume to ${newVolume}%` }
      );

      if (response.ok) {
        const data = (await response.json()) as VolumeApiResponse;
        if (data.volume !== undefined) {
          setVolume(data.volume);
        }
      } else {
        try {
          const currentData = await fetchWithTimeout(
            buildApiUrl('/api/volume/current'),
            {},
            DAEMON_CONFIG.TIMEOUTS.VERSION,
            { silent: true }
          );
          if (currentData.ok) {
            const currentVolume = (await currentData.json()) as VolumeApiResponse;
            if (currentVolume.volume !== undefined) {
              setVolume(currentVolume.volume);
            }
          }
        } catch (fetchErr) {
          console.warn('Failed to revert volume after error:', fetchErr);
        }
        console.warn('Failed to set volume:', response.status);
      }
    } catch (err) {
      try {
        const currentData = await fetchWithTimeout(
          buildApiUrl('/api/volume/current'),
          {},
          DAEMON_CONFIG.TIMEOUTS.VERSION,
          { silent: true }
        );
        if (currentData.ok) {
          const currentVolume = (await currentData.json()) as VolumeApiResponse;
          if (currentVolume.volume !== undefined) {
            setVolume(currentVolume.volume);
          }
        }
      } catch (fetchErr) {
        console.warn('Failed to revert volume after error:', fetchErr);
      }
      console.warn('Failed to set volume:', err);
    }
  }, []);

  const handleVolumeChange = useCallback(
    (newVolume: number): void => {
      setVolume(newVolume);

      if (volumeDebounceTimeoutRef.current) {
        clearTimeout(volumeDebounceTimeoutRef.current);
      }

      volumeDebounceTimeoutRef.current = setTimeout(() => {
        updateVolumeInApi(newVolume);
        volumeDebounceTimeoutRef.current = null;
      }, 500);
    },
    [updateVolumeInApi]
  );

  const updateMicrophoneVolumeInApi = useCallback(async (newVolume: number): Promise<void> => {
    try {
      const response = await fetchWithTimeout(
        buildApiUrl('/api/volume/microphone/set'),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ volume: newVolume }),
        },
        DAEMON_CONFIG.TIMEOUTS.VERSION,
        { silent: false, label: `Set microphone volume to ${newVolume}%` }
      );

      if (response.ok) {
        const data = (await response.json()) as VolumeApiResponse;
        if (data.volume !== undefined) {
          setMicrophoneVolume(data.volume);
        }
      } else {
        try {
          const currentData = await fetchWithTimeout(
            buildApiUrl('/api/volume/microphone/current'),
            {},
            DAEMON_CONFIG.TIMEOUTS.VERSION,
            { silent: true }
          );
          if (currentData.ok) {
            const currentVolume = (await currentData.json()) as VolumeApiResponse;
            if (currentVolume.volume !== undefined) {
              setMicrophoneVolume(currentVolume.volume);
            }
          }
        } catch (fetchErr) {
          console.warn('Failed to revert microphone volume after error:', fetchErr);
        }
        console.warn('Failed to set microphone volume:', response.status);
      }
    } catch (err) {
      try {
        const currentData = await fetchWithTimeout(
          buildApiUrl('/api/volume/microphone/current'),
          {},
          DAEMON_CONFIG.TIMEOUTS.VERSION,
          { silent: true }
        );
        if (currentData.ok) {
          const currentVolume = (await currentData.json()) as VolumeApiResponse;
          if (currentVolume.volume !== undefined) {
            setMicrophoneVolume(currentVolume.volume);
          }
        }
      } catch (fetchErr) {
        console.warn('Failed to revert microphone volume after error:', fetchErr);
      }
      console.warn('Failed to set microphone volume:', err);
    }
  }, []);

  const handleMicrophoneVolumeChange = useCallback(
    (newVolume: number): void => {
      setMicrophoneVolume(newVolume);

      if (microphoneDebounceTimeoutRef.current) {
        clearTimeout(microphoneDebounceTimeoutRef.current);
      }

      microphoneDebounceTimeoutRef.current = setTimeout(() => {
        updateMicrophoneVolumeInApi(newVolume);
        microphoneDebounceTimeoutRef.current = null;
      }, 500);
    },
    [updateMicrophoneVolumeInApi]
  );

  const handleMicrophoneChange = useCallback(
    (enabled: boolean): void => {
      handleMicrophoneVolumeChange(enabled ? 50 : 0);
    },
    [handleMicrophoneVolumeChange]
  );

  const handleSpeakerMute = useCallback((): void => {
    const newVolume = volume > 0 ? 0 : 50;

    if (volumeDebounceTimeoutRef.current) {
      clearTimeout(volumeDebounceTimeoutRef.current);
      volumeDebounceTimeoutRef.current = null;
    }

    setVolume(newVolume);

    updateVolumeInApi(newVolume);
  }, [volume, updateVolumeInApi]);

  const handleMicrophoneMute = useCallback((): void => {
    const newVolume = microphoneVolume > 0 ? 0 : 50;

    if (microphoneDebounceTimeoutRef.current) {
      clearTimeout(microphoneDebounceTimeoutRef.current);
      microphoneDebounceTimeoutRef.current = null;
    }

    setMicrophoneVolume(newVolume);

    updateMicrophoneVolumeInApi(newVolume);
  }, [microphoneVolume, updateMicrophoneVolumeInApi]);

  useEffect(() => {
    return () => {
      if (volumeDebounceTimeoutRef.current) {
        clearTimeout(volumeDebounceTimeoutRef.current);
      }
      if (microphoneDebounceTimeoutRef.current) {
        clearTimeout(microphoneDebounceTimeoutRef.current);
      }
    };
  }, []);

  return {
    volume,
    microphoneVolume,
    speakerDevice,
    microphoneDevice,
    speakerPlatform,
    microphonePlatform,
    selectedOutputDevice,
    selectedInputDevice,
    handleVolumeChange,
    handleMicrophoneChange,
    handleMicrophoneVolumeChange,
    handleSpeakerMute,
    handleMicrophoneMute,
    deviceSelectionSupported,
    outputDevices,
    inputDevices,
    devicesLoading,
    applyingDevice,
    refreshAudioDevices,
    handleSpeakerDeviceChange,
    handleMicrophoneDeviceChange,
  };
}
