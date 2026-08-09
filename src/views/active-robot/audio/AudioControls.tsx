import React from 'react';
import {
  Box,
  Typography,
  IconButton,
  Slider,
  Tooltip,
  Select,
  MenuItem,
  CircularProgress,
} from '@mui/material';
import MicIcon from '@mui/icons-material/Mic';
import MicOffIcon from '@mui/icons-material/MicOff';
import VolumeUpIcon from '@mui/icons-material/VolumeUp';
import VolumeOffIcon from '@mui/icons-material/VolumeOff';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import HearingDisabledIcon from '@mui/icons-material/HearingDisabled';
import AudioLevelBars from './AudioLevelBars';
import DoAIndicator from './DoAIndicator';
import type { AudioDevice } from './hooks/useAudioControls';
import { useDoA } from '../../../hooks/audio/useDoA';
import { useWebRTCStreamContext } from '../../../contexts/WebRTCStreamContext';
import useAudioAnalyser from '../../../hooks/media/useAudioAnalyser';
import { ACCENT, accentAlpha, whiteAlpha, blackAlpha } from '@styles/tokens';
import { DURATION, FONT_WEIGHT, TYPO, transition, useAppPalette } from '@styles';

/** Options for the per-scope device dropdown; omitted entirely when unsupported. */
interface DevicePicker {
  devices: AudioDevice[];
  /** Currently selected device name, as reported by the daemon. */
  selected: string | null;
  onChange: (deviceName: string) => void;
  onRefresh: () => void;
  loading: boolean;
  /** True while a switch is in flight — the pipeline rebuild takes ~10s. */
  applying: boolean;
}

export interface AudioControlsProps {
  volume: number;
  microphoneVolume: number;
  speakerDevice: string | null;
  microphoneDevice: string | null;
  speakerPlatform: string | null;
  microphonePlatform: string | null;
  onVolumeChange: (value: number) => void;
  onMicrophoneChange: (enabled: boolean) => void;
  onMicrophoneVolumeChange?: (value: number) => void;
  onSpeakerMute: () => void;
  onMicrophoneMute: () => void;
  /** False on daemons without the audio-devices router — renders read-only labels. */
  deviceSelectionSupported?: boolean;
  outputDevices?: AudioDevice[];
  inputDevices?: AudioDevice[];
  devicesLoading?: boolean;
  applyingDevice?: 'output' | 'input' | null;
  onRefreshDevices?: (scope: 'output' | 'input') => void;
  onSpeakerDeviceChange?: (deviceName: string) => void;
  onMicrophoneDeviceChange?: (deviceName: string) => void;
  /** @deprecated Theme mode is now read from `useAppPalette()`. Prop kept for back-compat but ignored. */
  darkMode?: boolean;
  disabled?: boolean;
  isSleeping?: boolean;
}

/**
 * Audio Controls Component - Speaker and Microphone controls
 * Simplified and robust sizing for Tauri context
 */
function AudioControls({
  volume,
  microphoneVolume,
  speakerDevice,
  microphoneDevice,
  speakerPlatform,
  microphonePlatform,
  onVolumeChange,
  onMicrophoneChange,
  onMicrophoneVolumeChange,
  onSpeakerMute,
  onMicrophoneMute,
  deviceSelectionSupported = false,
  outputDevices = [],
  inputDevices = [],
  devicesLoading = false,
  applyingDevice = null,
  onRefreshDevices,
  onSpeakerDeviceChange,
  onMicrophoneDeviceChange,
  disabled = false,
  isSleeping = false,
}: AudioControlsProps): React.ReactElement {
  const palette = useAppPalette();
  const isMicActive = microphoneVolume > 0 && !disabled;

  // Get WebRTC context - available when daemon exposes WebRTC (WiFi + USB/Lite)
  const { audioTrack, isWebRTCAvailable } = useWebRTCStreamContext();

  // DoA and audio visualization available when WebRTC stream is active
  const { angle, isTalking, isAvailable } = useDoA((isWebRTCAvailable && isMicActive) as boolean);
  const { level: microphoneLevel } = useAudioAnalyser(
    isWebRTCAvailable && isMicActive ? audioTrack : null
  );
  // Shared styles
  const cardStyle = {
    height: 64,
    borderRadius: '14px',
    // TODO(style-migration): card bg uses opaque #1a1a1a / #ffffff here; palette.surfaceCard is 0.95 alpha.
    bgcolor: palette.isDark ? '#1a1a1a' : '#ffffff',
    border: `1px solid ${palette.isDark ? whiteAlpha(0.15) : blackAlpha(0.15)}`,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  };

  const sliderStyle = {
    mb: 0,
    color: ACCENT.main,
    height: 3,
    '& .MuiSlider-thumb': {
      width: 12,
      height: 12,
      backgroundColor: ACCENT.main,
      // TODO(style-migration): thumb border mirrors the card bg (#1a1a1a/#fff) rather than a semantic token.
      border: `1.5px solid ${palette.isDark ? '#1a1a1a' : '#fff'}`,
      boxShadow: 'none',
      '&:hover': { boxShadow: `0 0 0 6px ${accentAlpha(0.12)}` },
      '&.Mui-focusVisible': { boxShadow: `0 0 0 6px ${accentAlpha(0.16)}` },
      '&.Mui-active': { boxShadow: `0 0 0 6px ${accentAlpha(0.16)}` },
    },
    '& .MuiSlider-track': {
      backgroundColor: ACCENT.main,
      border: 'none',
      height: 1.5,
    },
    '& .MuiSlider-rail': {
      backgroundColor: palette.isDark ? whiteAlpha(0.12) : blackAlpha(0.12),
      height: 1.5,
      opacity: 1,
    },
  };

  const deviceTextStyle = {
    fontSize: TYPO.micro,
    fontWeight: FONT_WEIGHT.medium,
    color: palette.isDark ? whiteAlpha(0.4) : blackAlpha(0.4),
    fontFamily: 'SF Mono, Monaco, Menlo, monospace',
    letterSpacing: '0.02em',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  };

  const platformTextStyle = {
    fontSize: 8,
    fontWeight: FONT_WEIGHT.regular,
    color: palette.isDark ? whiteAlpha(0.2) : blackAlpha(0.2),
    fontFamily: 'SF Mono, Monaco, Menlo, monospace',
    letterSpacing: '0.02em',
  };

  const selectStyle = {
    ...deviceTextStyle,
    width: '100%',
    '& .MuiSelect-select': {
      ...deviceTextStyle,
      padding: 0,
      paddingRight: '18px !important',
    },
    '& .MuiSelect-icon': {
      fontSize: TYPO.md,
      right: 0,
      color: palette.isDark ? whiteAlpha(0.4) : blackAlpha(0.4),
    },
    '& .MuiOutlinedInput-notchedOutline': { border: 'none' },
    '&:hover .MuiSelect-select': { color: ACCENT.main },
    '&.Mui-disabled': { opacity: 0.6 },
  };

  /**
   * Device row: a dropdown when the daemon supports selection, otherwise the
   * original read-only label. Selecting rebuilds the media pipeline (~10s), so
   * the control is disabled while `applying` and shows a spinner.
   */
  const renderDeviceRow = (device: string, picker: DevicePicker | null): React.ReactElement => {
    if (!picker || picker.devices.length === 0) {
      return <Typography sx={deviceTextStyle}>{device}</Typography>;
    }

    const selectedEntry = picker.devices.find(d => d.name === picker.selected);
    // Only warn once we know the device: absent AEC is the real trade-off of
    // any external output, and it is otherwise silent until mid-conversation.
    const losesAec = selectedEntry ? !selectedEntry.aec : false;

    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0, width: '100%' }}>
        <Select
          value={picker.devices.some(d => d.name === picker.selected) ? picker.selected : ''}
          onChange={e => picker.onChange(e.target.value as string)}
          onOpen={() => picker.onRefresh()}
          disabled={disabled || picker.applying}
          variant="outlined"
          size="small"
          displayEmpty
          renderValue={val => {
            if (picker.applying) return 'Switching…';
            if (!val) return picker.loading ? 'Loading…' : device;
            return val as string;
          }}
          sx={selectStyle}
          MenuProps={{ PaperProps: { sx: { maxHeight: 240 } } }}
        >
          {/*
            Clearing is not the same as picking the built-in by name: with no
            selection the daemon uses the stock ALSA path, whereas any explicit
            selection routes through PipeWire. This item issues the DELETE that
            restores stock behavior.
          */}
          <MenuItem value="" sx={{ fontSize: TYPO.micro, fontStyle: 'italic' }}>
            Default (built-in)
          </MenuItem>
          {picker.devices.map(d => (
            <MenuItem key={d.name} value={d.name} sx={{ fontSize: TYPO.micro }}>
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 0.75,
                  minWidth: 0,
                  width: '100%',
                }}
              >
                <Box component="span" sx={{ flex: 1, minWidth: 0 }}>
                  {d.name}
                </Box>
                {!d.aec && (
                  <Tooltip title="No hardware echo cancellation on this output" arrow>
                    <HearingDisabledIcon sx={{ fontSize: TYPO.sm, opacity: 0.5, flexShrink: 0 }} />
                  </Tooltip>
                )}
              </Box>
            </MenuItem>
          ))}
        </Select>
        {picker.applying && <CircularProgress size={10} sx={{ flexShrink: 0 }} />}
        {!picker.applying && losesAec && (
          <Tooltip
            title="Echo cancellation is done in hardware by the built-in speaker path. On an external output the robot will hear its own voice — prefer push-to-talk or half-duplex."
            arrow
            placement="top"
          >
            <HearingDisabledIcon
              sx={{ fontSize: TYPO.sm, color: ACCENT.main, opacity: 0.75, flexShrink: 0 }}
            />
          </Tooltip>
        )}
      </Box>
    );
  };

  const renderControl = (
    label: string,
    tooltip: string,
    device: string,
    platform: string | null,
    volume: number,
    isActive: boolean,
    onMute: () => void,
    onVolumeChange: (value: number) => void,
    extraIndicator: React.ReactNode = null,
    externalAudioLevel: number | null = null,
    devicePicker: DevicePicker | null = null
  ): React.ReactElement => (
    <Box
      sx={{
        flex: 1,
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
        gap: 0.75,
        opacity: disabled ? 0.5 : 1,
        transition: transition('opacity', DURATION.base),
      }}
    >
      {/* Label row with optional indicator on the right */}
      <Box
        sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 0.5 }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <Typography
            sx={{
              fontSize: TYPO.xs,
              fontWeight: FONT_WEIGHT.semibold,
              color: palette.textMuted,
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
            }}
          >
            {label}
          </Typography>
          <Tooltip title={tooltip} arrow placement="top">
            <InfoOutlinedIcon
              sx={{ fontSize: TYPO.sm, color: palette.textMuted, opacity: 0.6, cursor: 'help' }}
            />
          </Tooltip>
        </Box>
        {/* Extra indicator (DoA) on the right of label */}
        {extraIndicator}
      </Box>

      {/* Card */}
      <Box sx={{ ...cardStyle, width: '100%', boxSizing: 'border-box' }}>
        {/* Controls row */}
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 1,
            p: 1.5,
            pb: 0,
            minWidth: 0,
          }}
        >
          {/* Device info */}
          <Box
            sx={{
              flex: 1,
              minWidth: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: 0.25,
              overflow: 'hidden',
            }}
          >
            {renderDeviceRow(device, devicePicker)}
            {platform && <Typography sx={platformTextStyle}>{platform}</Typography>}
          </Box>

          {/* Mute button and slider */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexShrink: 0 }}>
            <IconButton
              onClick={onMute}
              disabled={disabled}
              size="small"
              sx={{
                width: 20,
                height: 20,
                padding: 0,
                flexShrink: 0,
                color: isActive
                  ? palette.isDark
                    ? whiteAlpha(0.6)
                    : blackAlpha(0.6)
                  : palette.isDark
                    ? whiteAlpha(0.3)
                    : blackAlpha(0.3),
                '&:hover': {
                  color: isActive
                    ? ACCENT.main
                    : palette.isDark
                      ? whiteAlpha(0.5)
                      : blackAlpha(0.5),
                  bgcolor: 'transparent',
                },
              }}
            >
              {isActive ? (
                label === 'Speaker' ? (
                  <VolumeUpIcon sx={{ fontSize: TYPO.md }} />
                ) : (
                  <MicIcon sx={{ fontSize: TYPO.md }} />
                )
              ) : label === 'Speaker' ? (
                <VolumeOffIcon sx={{ fontSize: TYPO.md }} />
              ) : (
                <MicOffIcon sx={{ fontSize: TYPO.md }} />
              )}
            </IconButton>
            <Box
              sx={{ width: 60, height: 24, display: 'flex', alignItems: 'center', flexShrink: 0 }}
            >
              <Slider
                value={volume}
                onChange={(_e, val) => onVolumeChange(val as number)}
                disabled={disabled}
                size="small"
                sx={sliderStyle}
              />
            </Box>
          </Box>
        </Box>

        {/* Visualizer - only show if we have real audio data */}
        {externalAudioLevel !== null && (
          <Box
            sx={{
              width: '100%',
              height: '28px',
              flexShrink: 0,
              overflow: 'hidden',
              boxSizing: 'border-box',
            }}
          >
            <AudioLevelBars
              isActive={isActive}
              color={palette.isDark ? whiteAlpha(0.35) : blackAlpha(0.3)}
              barCount={8}
              externalLevel={externalAudioLevel}
            />
          </Box>
        )}
      </Box>
    </Box>
  );

  return (
    <Box
      sx={{
        width: '100%',
        mb: 1.5,
        display: 'flex',
        gap: 1.5,
        alignItems: 'stretch',
        minWidth: 0,
        boxSizing: 'border-box',
      }}
    >
      {renderControl(
        'Speaker',
        "Adjust the robot's audio output volume",
        speakerDevice || 'Built-in Speaker',
        speakerPlatform,
        volume,
        volume > 0,
        onSpeakerMute,
        onVolumeChange,
        null,
        null,
        deviceSelectionSupported && onSpeakerDeviceChange
          ? {
              devices: outputDevices,
              selected: speakerDevice,
              onChange: onSpeakerDeviceChange,
              onRefresh: () => onRefreshDevices?.('output'),
              loading: devicesLoading,
              applying: applyingDevice === 'output',
            }
          : null
      )}
      {renderControl(
        'Microphone',
        "Adjust the robot's microphone input volume",
        microphoneDevice || 'USB Microphone',
        microphonePlatform,
        microphoneVolume,
        microphoneVolume > 0,
        onMicrophoneMute,
        onMicrophoneVolumeChange || (val => onMicrophoneChange(val > 0)),
        // DoA indicator when WebRTC is available AND robot is awake
        isWebRTCAvailable && !isSleeping ? (
          <DoAIndicator angle={angle} isTalking={isTalking} isAvailable={isAvailable} />
        ) : null,
        // Audio waveform when WebRTC is available AND robot is awake
        isWebRTCAvailable && !isSleeping ? microphoneLevel : null,
        deviceSelectionSupported && onMicrophoneDeviceChange
          ? {
              devices: inputDevices,
              selected: microphoneDevice,
              onChange: onMicrophoneDeviceChange,
              onRefresh: () => onRefreshDevices?.('input'),
              loading: devicesLoading,
              applying: applyingDevice === 'input',
            }
          : null
      )}
    </Box>
  );
}

export default React.memo(AudioControls);
