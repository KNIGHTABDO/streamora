import Foundation
import UIKit
import Capacitor

// JS: Capacitor.Plugins.StreamoraPlayer.play({ url, title, subtitle, start, hasNext, audioLang, subsLang }) / close()
//     extras({ subs: [{label, lang, url}], intro: [start, end]?, outro: [start, end]? }) once the web side has them
// Events: 'progress' {position, duration, paused}, 'next', 'closed' {position, duration, ended, error?}
@objc(StreamoraPlayerPlugin)
public class StreamoraPlayerPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "StreamoraPlayerPlugin"
    public let jsName = "StreamoraPlayer"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "play", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "close", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "extras", returnType: CAPPluginReturnPromise)
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
            hasNext: call.getBool("hasNext") ?? false,
            audioLang: call.getString("audioLang") ?? "",
            subsLang: call.getString("subsLang") ?? ""
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

    @objc func extras(_ call: CAPPluginCall) {
        let list = (call.options["subs"] as? [Any] ?? []).compactMap { $0 as? [String: Any] }
        let subs: [OnlineSub] = list.compactMap { d in
            guard let u = d["url"] as? String, let url = URL(string: u) else { return nil }
            return OnlineSub(label: d["label"] as? String ?? "Subtitles", lang: d["lang"] as? String ?? "", url: url)
        }
        func range(_ k: String) -> (Double, Double)? {
            guard let a = call.options[k] as? [Any], a.count == 2,
                  let x = (a[0] as? NSNumber)?.doubleValue, let y = (a[1] as? NSNumber)?.doubleValue, y > x else { return nil }
            return (x, y)
        }
        let intro = range("intro"), outro = range("outro")
        DispatchQueue.main.async {
            self.current?.setExtras(subs: subs, intro: intro, outro: outro)
            call.resolve()
        }
    }

    @objc func close(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.current?.finish(notify: false)
            call.resolve()
        }
    }
}
