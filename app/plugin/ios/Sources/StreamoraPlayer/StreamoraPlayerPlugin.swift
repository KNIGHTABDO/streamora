import Foundation
import UIKit
import Capacitor

// JS: Capacitor.Plugins.StreamoraPlayer.play({ url, title, subtitle, start, hasNext, audioLang, subsLang }) / close()
//     extras({ subs: [{label, lang, url}], intro: [start, end]?, outro: [start, end]? }) once the web side has them
// Engine mode (the web player's own controls on top of VLC, see VlcEngine.swift and js/player/vlc.js):
//     capabilities() -> { engine: true } · engineOpen({ url, start, audioLang }) · enginePlay() · enginePause()
//     engineSeek({ time }) · engineRate({ rate }) · engineVolume({ volume, muted }) · engineAudio({ id }) · engineSub({ id }) · engineClose()
// Events: 'progress' {position, duration, paused}, 'next', 'closed' {position, duration, ended, error?}
@objc(StreamoraPlayerPlugin)
public class StreamoraPlayerPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "StreamoraPlayerPlugin"
    public let jsName = "StreamoraPlayer"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "play", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "close", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "extras", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "capabilities", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "engineOpen", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "enginePlay", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "enginePause", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "engineSeek", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "engineRate", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "engineVolume", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "engineAudio", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "engineSub", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "engineClose", returnType: CAPPluginReturnPromise)
    ]

    private weak var current: PlayerViewController?
    private var engine: VlcEngine?

    @objc func capabilities(_ call: CAPPluginCall) { call.resolve(["engine": true]) }

    @objc func engineOpen(_ call: CAPPluginCall) {
        guard let s = call.getString("url"), let url = URL(string: s) else { return call.reject("No playable link") }
        let start = call.getDouble("start") ?? 0, audioLang = call.getString("audioLang") ?? ""
        DispatchQueue.main.async {
            self.engine?.close()
            guard let web = self.bridge?.webView,
                  let e = VlcEngine(webView: web, url: url, start: start, audioLang: audioLang, send: { [weak self] ev, data in self?.notifyListeners(ev, data: data) })
            else { return call.reject("No view to play in") }
            self.engine = e
            call.resolve()
        }
    }

    private func onEngine(_ call: CAPPluginCall, _ f: @escaping (VlcEngine) -> Void) {
        DispatchQueue.main.async {
            if let e = self.engine { f(e) }
            call.resolve()
        }
    }
    @objc func enginePlay(_ call: CAPPluginCall) { onEngine(call) { $0.play() } }
    @objc func enginePause(_ call: CAPPluginCall) { onEngine(call) { $0.pause() } }
    @objc func engineSeek(_ call: CAPPluginCall) { let t = call.getDouble("time") ?? 0; onEngine(call) { $0.seek(t) } }
    @objc func engineRate(_ call: CAPPluginCall) { let r = call.getDouble("rate") ?? 1; onEngine(call) { $0.setRate(r) } }
    @objc func engineVolume(_ call: CAPPluginCall) {
        let v = call.getDouble("volume") ?? 1, m = call.getBool("muted") ?? false
        onEngine(call) { $0.setVolume(v, muted: m) }
    }
    @objc func engineAudio(_ call: CAPPluginCall) { let i = Int32(call.getInt("id") ?? -1); onEngine(call) { $0.setAudio(i) } }
    @objc func engineSub(_ call: CAPPluginCall) { let i = Int32(call.getInt("id") ?? -1); onEngine(call) { $0.setSub(i) } }
    @objc func engineClose(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.engine?.close()
            self.engine = nil
            call.resolve()
        }
    }

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
