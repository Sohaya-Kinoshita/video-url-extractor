`mux-test-segment.bin` is the MPEG-TS test segment from videojs/mux.js:
https://github.com/videojs/mux.js/blob/main/test/segments/test-segment.ts

It is used to test real H.264/AAC-to-MP4 transmuxing. The `.bin` extension
keeps Node's test runner from interpreting MPEG-TS data as TypeScript.
The mux.js Apache-2.0 license is included at
`../../public/vendor/mux-LICENSE.txt`.
