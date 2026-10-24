`mux-test-segment.bin` is the MPEG-TS test segment from videojs/mux.js:
https://github.com/videojs/mux.js/blob/main/test/segments/test-segment.ts

It is used to test real H.264/AAC-to-MP4 transmuxing. The `.bin` extension
keeps Node's test runner from interpreting MPEG-TS data as TypeScript.
The mux.js Apache-2.0 license is included at
`mux-LICENSE.txt`.

`visible-h264-aac.bin` is a generated, non-black test pattern with H.264
B-frames and AAC audio. It contains three seconds of a moving color pattern
and a 440 Hz tone. Generated using FFmpeg's `testsrc2` and `sine` filters
(320x180, 30 fps, GOP 30, two B-frames).
