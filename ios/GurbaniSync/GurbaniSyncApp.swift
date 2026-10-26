import SwiftUI
import WebKit

@main
struct GurbaniSyncApp: App {
    var body: some Scene { WindowGroup { GurbaniHome() } }
}

struct GurbaniHome: View {
    @State private var failure: String?
    @State private var loading = true
    @State private var reloadID = UUID()

    var body: some View {
        ZStack {
            Color(red: 0.97, green: 0.96, blue: 0.94).ignoresSafeArea()
            GurbaniWebsite(failure: $failure, loading: $loading)
                .id(reloadID)
            if loading && failure == nil {
                ProgressView("Opening Gurbani Sync…")
                    .padding(24).background(.regularMaterial, in: RoundedRectangle(cornerRadius: 16))
            }
            if let failure {
                VStack(spacing: 20) {
                    Text("ੴ").font(.system(size: 64)).foregroundStyle(.orange)
                    Text("Unable to open Gurbani Sync").font(.title2.bold())
                    Text(failure).multilineTextAlignment(.center).foregroundStyle(.secondary)
                    Button("Try again") {
                        self.failure = nil
                        loading = true
                        reloadID = UUID()
                    }.buttonStyle(.borderedProminent)
                }.padding(28).frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(Color(uiColor: .systemBackground))
            }
        }
    }
}

struct GurbaniWebsite: UIViewRepresentable {
    @Binding var failure: String?
    @Binding var loading: Bool

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.allowsInlineMediaPlayback = true
        configuration.mediaTypesRequiringUserActionForPlayback = []
        let view = WKWebView(frame: .zero, configuration: configuration)
        view.navigationDelegate = context.coordinator
        view.uiDelegate = context.coordinator
        view.isOpaque = false
        view.backgroundColor = .clear
        view.allowsBackForwardNavigationGestures = true
        view.load(URLRequest(url: URL(string: "https://gurbanisync.com/")!))
        return view
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {
        context.coordinator.parent = self
    }

    static func dismantleUIView(_ uiView: WKWebView, coordinator: Coordinator) {
        uiView.stopLoading()
        // Navigating away destroys the page and releases its microphone session.
        uiView.loadHTMLString("", baseURL: nil)
        uiView.navigationDelegate = nil
        uiView.uiDelegate = nil
    }

    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate {
        var parent: GurbaniWebsite
        init(_ parent: GurbaniWebsite) { self.parent = parent }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            parent.loading = false
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            failed(error)
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            failed(error)
        }

        private func failed(_ error: Error) {
            let code = (error as NSError).code
            guard code != NSURLErrorCancelled else { return }
            parent.loading = false
            if [NSURLErrorSecureConnectionFailed, NSURLErrorServerCertificateUntrusted,
                NSURLErrorServerCertificateHasBadDate, NSURLErrorServerCertificateHasUnknownRoot,
                NSURLErrorServerCertificateNotYetValid].contains(code) {
                parent.failure = "The website’s secure connection is not ready. Its HTTPS certificate must be active before the app can connect."
            } else {
                parent.failure = "Check your internet connection and try again."
            }
        }

        func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                     decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            guard let url = navigationAction.request.url else { decisionHandler(.cancel); return }
            if url.absoluteString == "about:blank" { decisionHandler(.allow); return }
            guard url.scheme == "https" else { decisionHandler(.cancel); return }
            if url.host == "gurbanisync.com" || url.host == "www.gurbanisync.com" {
                decisionHandler(.allow)
            } else {
                decisionHandler(.cancel)
                // Only explicit link taps may open an external browser.
                if navigationAction.navigationType == .linkActivated {
                    UIApplication.shared.open(url)
                }
            }
        }

        func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin,
                     initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType,
                     decisionHandler: @escaping (WKPermissionDecision) -> Void) {
            guard origin.protocol == "https", origin.host == "gurbanisync.com",
                  frame.isMainFrame, type == .microphone else {
                decisionHandler(.deny)
                return
            }
            decisionHandler(.prompt)
        }

        func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
            parent.loading = false
            parent.failure = "Listening used more memory than this device could provide. Tap Try again to reopen the app."
        }
    }
}
