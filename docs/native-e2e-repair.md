# Native Pet test repair

Issue #69 was reproduced after the development harness on macOS.
The native focus test supplied a closed standard input and obsolete file, owner-process, and shared-singleton arguments.
The current plugin uses a private open input pipe, delivers events through that pipe, and ends its Pet by closing it.
The old test could briefly see the panel and then wait for an accessibility image after input end had already terminated the process.

The test now holds the input open, sends the real resize event through it, waits for the resized accessibility frame, and verifies independent session shutdown on end of input.
It checks the existing global shortcut instead of a hide button that the current interface does not contain.
Native startup failures retain stderr for diagnosis.
Renderer tests use independent temporary Electron profiles and the harness waits for its child to exit before cleanup.
The native CI job now runs for pull requests and relevant pushes as well as scheduled runs.

One complete local native run passed launch, transparent pass-through, visible-pixel clicking, resizing, dragging, focus preservation, shortcut visibility, and both session lifecycles.
Repeated local runs also observed pointer movement during synthetic input, with failures to hit the expected sprite point.
Temporary geometry instrumentation was removed after diagnosis.
This workstation result does not establish that the scheduled workflow on main passes.
Issue #69 remains open until hosted CI verifies the corrected test and the required main-branch workflow passes.
