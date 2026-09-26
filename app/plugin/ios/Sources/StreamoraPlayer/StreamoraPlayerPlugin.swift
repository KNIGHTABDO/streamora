import Foundation
import UIKit
import Capacitor

// JS: Capacitor.Plugins.StreamoraPlayer.play({ url, title, subtitle, start, hasNext }) / close()
// Events: 'progress' {position, duration, paused}, 'next', 'closed' {position, duration, ended, error?}
@objc(StreamoraPlayerPlugin)
public class StreamoraPlayerPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "StreamoraPlayerPlugin"
    public let jsName = "StreamoraPlayer"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "play", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "close", returnType: CAPPluginReturnPromise)
    ]

    private weak var current: PlayerViewController?

    @objc func play(_ call: CAPPluginCall) {
        guard let s = call.getString("url"), let url = URL(string: s) else {
            call.reject("No playable link")
            return
        }
        let opts = PlayerOptions(
            url: url,
            title: call.getString("title") ?? "",
            subtitle: call.getString("subtitle") ?? "",
            start: call.getDouble("start") ?? 0,
            hasNext: call.getBool("hasNext") ?? false
        )
        DispatchQueue.main.async {
            guard let host = self.bridge?.viewController else {
                call.reject("No view to present from")
                return
            }
            self.current?.finish(notify: false)
            let vc = PlayerViewController(options: opts) { [weak self] event, data in
                self?.notifyListeners(event, data: data)
            }
            vc.modalPresentationStyle = .fullScreen
            self.current = vc
            let top = host.presentedViewController ?? host
            top.present(vc, animated: true) { call.resolve() }
        }
    }

    @objc func close(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.current?.finish(notify: false)
            call.resolve()
        }
    }
}
