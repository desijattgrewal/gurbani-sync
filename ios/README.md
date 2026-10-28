# Gurbani Sync for iPhone and iPad

This first iOS version is a SwiftUI app containing the existing website in WKWebView.
It includes a microphone usage description, asks permission only for the first-party
HTTPS page, denies camera capture, handles connection errors, and retains the site's
microphone-only interface. It does not add native speech recognition or a search box.

## Open and install

Requires a Mac with Xcode and XcodeGen (https://github.com/yonaskolb/XcodeGen).
Install XcodeGen from Homebrew with `brew install xcodegen`, then:

```sh
cd ios
xcodegen generate
open GurbaniSync.xcodeproj
```

In Xcode select the GurbaniSync target, Signing & Capabilities, and your Apple team.
Change the bundle identifier if needed, select a connected iPhone, then Run.
No development team identifier or signing credential is committed. A personal Apple
account can be used for device development under Apple's current restrictions.
TestFlight/App Store distribution requires the appropriate Apple Developer membership,
a signed archive, app icon assets, privacy disclosures, screenshots, and review.
This project has not been submitted to Apple. A website wrapper alone may not satisfy
App Store minimum-functionality review requirements.

## Prerequisites and validation

- `https://gurbanisync.com/` must serve a valid certificate. The app intentionally
  has no HTTP or certificate-validation bypass. Pending GitHub HTTPS blocks this app too.
- WKWebView speech APIs can differ from Safari. The site includes a local Whisper
  fallback, but real-device accuracy, runtime/model loading, speed, memory use, and
  permission behavior must be tested on an iPhone. This is source code, not a verified IPA.
- First fallback use downloads the model from Hugging Face and runtime from jsDelivr.
  Local fallback audio stays on the device; native browser recognition, if available,
  follows the browser recognition provider's processing behavior.
- The generated project targets iOS 16+. Xcode compilation and device tests were not
  possible in the Linux authoring environment.

Device acceptance checks: launch; grant/deny microphone; start/stop listening; identify
known paath; follow lines; switch slideshow/full view; rotate; background/foreground;
check microphone release after closing; test interrupted internet and certificate errors.
