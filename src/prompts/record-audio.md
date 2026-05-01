
# Record Audio

Start capturing Mac system audio using BlackHole 2ch.

## Prerequisites
- BlackHole 2ch installed (`brew install blackhole-2ch`)
- System output set to a Multi-Output Device that includes BlackHole 2ch
- ffmpeg installed (`brew install ffmpeg`)

## Steps

1. Build the output filename using the current timestamp:
   ```
   ~/Recordings/{{prefix}}_YYYY-MM-DD_HH-MM-SS.m4a
   ```
   If `{{prefix}}` was not provided, use `recording`.

2. Run ffmpeg in the background:
   ```bash
   ffmpeg -f avfoundation -i ":BlackHole 2ch" -c:a aac -b:a 192k "<output_file>" > /tmp/audio_recording.log 2>&1 &
   ```

3. Save the PID and file path:
   ```bash
   echo $! > /tmp/audio_recording.pid
   echo "<output_file>" > /tmp/audio_recording.path
   ```

4. Confirm to the user:
   - Recording has started
   - Output file path
   - How to stop: invoke the `stop-recording` prompt

## Error Handling
- If `/tmp/audio_recording.pid` already exists and the process is still running, warn the user that a recording is already in progress and show the current file path. Do not start a second recording.
- If ffmpeg is not found: `brew install ffmpeg`
- If BlackHole 2ch is not available as an input device, tell the user to check Audio MIDI Setup and the system output device.
