
# Stop Recording

Stop the active system audio recording and finalize the file.

## Steps

1. Check that a recording is in progress:
   ```bash
   cat /tmp/audio_recording.pid 2>/dev/null
   ```
   If the file doesn't exist or is empty, tell the user there is no active recording.

2. Read the PID and file path:
   ```bash
   PID=$(cat /tmp/audio_recording.pid)
   FILE=$(cat /tmp/audio_recording.path)
   ```

3. Check the process is still running:
   ```bash
   kill -0 $PID 2>/dev/null
   ```
   If it's not running, clean up the tmp files and tell the user the recording already stopped (possibly due to an error — check `cat /tmp/audio_recording.log`).

4. Send SIGINT to allow ffmpeg to finalize the file cleanly:
   ```bash
   kill -INT $PID
   sleep 1
   ```

5. Clean up:
   ```bash
   rm -f /tmp/audio_recording.pid /tmp/audio_recording.path
   ```

6. Confirm to the user:
   - Recording stopped
   - Full path of the saved file
   - File size (use `du -sh <file>`)

## Error Handling
- If the file is 0 bytes or missing after stopping, show the ffmpeg log: `cat /tmp/audio_recording.log`
- Suggest checking that the system output was set to the Multi-Output Device during recording.
