# Third-party notices

## OpenHands (All Hands AI)

DigitalRCC LabOps AI runs the OpenHands Agent Server as an unmodified container image,
pinned in `crc-awx-labops` under `platform/labops-ai/`:

```
ghcr.io/openhands/agent-server:1.42.1-python
sha256:141a3628925a18ad55f07a09a1e3db9852ab0043458dbe7c8003c92396d143
```

No OpenHands source is vendored into this repository; `lib/labops/agent.ts` and
`lib/labops/agent-protocol.ts` are original clients for its documented HTTP API. OpenHands
is distributed under the MIT License:

```
MIT License

Copyright (c) 2024 All Hands AI

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

The DigitalRCC interface is a separate original work; the stock OpenHands UI is not served
and its branding is not used.
