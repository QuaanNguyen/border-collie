# Use a native macOS panel for the production Pet

## Status

Accepted.

## Context

Pet needs a transparent cross-platform window, visible-pixel hit testing, pointer interaction, a global shortcut, and a shared lifecycle across OpenCode sessions.
Guard does not need a desktop runtime.
Electron 44.3.0 documents a macOS `panel` window type that applies the non-activating panel mask.
Repeated operating-system input tests still showed intermittent activation and focus loss with Electron's panel implementation.
The upstream reports describe the same limitation and do not identify a supported Electron configuration that provides a keyboard-capable, non-activating macOS panel.

## Decision

The production macOS Pet uses a small AppKit host built around a true non-activating `NSPanel` and the system `WKWebView`.
It retains the shared HTML, CSS, JavaScript, animation assets, event contract, and visible-pixel hit regions.
The host handles window dragging, global shortcuts, persistent layout, and shared session ownership at the native boundary.
Electron remains locked for Windows, Linux, and development mode.
The default macOS installation compiles the native host and does not download Electron.
The Guard-only installation omits every desktop runtime.

## Consequences

Production clicks and drags on macOS preserve the previously active application.
The macOS install is smaller and uses the WebKit framework already provided by the operating system.
The project maintains a thin platform host while continuing to share the Pet renderer and behavior.
Native macOS acceptance tests exercise launch, transparent pass-through, visible-pixel clicks, dragging, controls, shortcuts, and shared ownership with real operating-system input.
Windows and Linux retain Electron until equivalent platform acceptance tests justify another host.

## References

- [Electron releases](https://releases.electronjs.org/)
- [Electron BaseWindow panel behavior](https://www.electronjs.org/docs/latest/api/base-window)
- [Electron macOS focus report](https://github.com/electron/electron/issues/35815)
- [Electron focusable false report](https://github.com/electron/electron/issues/29644)
- [Electron non-activating panel enhancement](https://github.com/electron/electron/issues/52915)
- [Electron native panel discussion](https://github.com/electron/electron/issues/31538)
