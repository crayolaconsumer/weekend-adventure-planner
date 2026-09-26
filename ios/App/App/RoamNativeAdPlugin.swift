import UIKit
import Capacitor
import GoogleMobileAds

// Native AdMob ad drawn in ROAM's card frame over a web placeholder. Contract: /tmp/roam-ad-card/contract.md
@objc(RoamNativeAdPlugin)
public class RoamNativeAdPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "RoamNativeAdPlugin"
    public let jsName = "RoamNativeAd"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "load", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "show", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "hide", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "destroy", returnType: CAPPluginReturnPromise)
    ]

    // Touched on the main thread only.
    private var slots: [String: AdSlot] = [:]

    @objc func load(_ call: CAPPluginCall) {
        guard let id = call.getString("slot"), let unit = call.getString("adUnitId") else {
            call.reject("slot and adUnitId are required")
            return
        }
        DispatchQueue.main.async {
            let slot = self.slots[id] ?? AdSlot(id: id, plugin: self)
            self.slots[id] = slot
            if slot.ad != nil {
                call.resolve(["slot": id])
                return
            }
            slot.pending.append(call)
            if slot.loader != nil { return }

            let viewOptions = NativeAdViewAdOptions()
            viewOptions.preferredAdChoicesPosition = .topRightCorner
            let mediaOptions = NativeAdMediaAdLoaderOptions()
            mediaOptions.mediaAspectRatio = .any
            let loader = AdLoader(adUnitID: unit, rootViewController: self.bridge?.viewController,
                                  adTypes: [.native], options: [viewOptions, mediaOptions])
            loader.delegate = slot
            slot.loader = loader
            loader.load(Request())
        }
    }

    @objc func show(_ call: CAPPluginCall) {
        guard let id = call.getString("slot") else { call.reject("slot is required"); return }
        let rect = CGRect(x: call.getDouble("x") ?? 0, y: call.getDouble("y") ?? 0,
                          width: call.getDouble("width") ?? 0, height: call.getDouble("height") ?? 0)
        let dark = call.getBool("dark") ?? false
        DispatchQueue.main.async {
            guard let slot = self.slots[id], let ad = slot.ad,
                  let webView = self.bridge?.webView, let host = self.bridge?.viewController?.view else {
                call.reject("ad not loaded")
                return
            }
            let card = slot.card ?? RoamAdCardView(ad: ad)
            if slot.card == nil {
                card.onDismiss = { [weak self] direction in
                    self?.destroySlot(id)
                    self?.notifyListeners("adDismissed", data: ["slot": id, "direction": direction])
                }
                slot.card = card
            }
            card.apply(dark: dark)

            // getBoundingClientRect is relative to the visible viewport. With contentInset "always"
            // that viewport starts at the scroll view's adjusted inset, i.e. at contentOffset + inset
            // in scroll view coordinates; converting from there follows the insets and any scroll.
            let scroll = webView.scrollView
            let inset = scroll.adjustedContentInset
            let inScroll = rect.offsetBy(dx: scroll.contentOffset.x + inset.left, dy: scroll.contentOffset.y + inset.top)
            card.place(scroll.convert(inScroll, to: host))
            if card.superview !== host { host.addSubview(card) }
            call.resolve()
        }
    }

    @objc func hide(_ call: CAPPluginCall) {
        let id = call.getString("slot") ?? ""
        DispatchQueue.main.async {
            self.slots[id]?.card?.removeFromSuperview()
            call.resolve()
        }
    }

    @objc func destroy(_ call: CAPPluginCall) {
        let id = call.getString("slot") ?? ""
        DispatchQueue.main.async {
            self.destroySlot(id)
            call.resolve()
        }
    }

    fileprivate func destroySlot(_ id: String) {
        guard let slot = slots.removeValue(forKey: id) else { return }
        slot.card?.removeFromSuperview()
        slot.card = nil
        slot.ad?.delegate = nil
        slot.ad = nil
        slot.loader?.delegate = nil
        slot.loader = nil
        slot.rejectPending("destroyed")
    }

    fileprivate func loadFailed(_ id: String, message: String) {
        guard let slot = slots.removeValue(forKey: id) else { return }
        slot.loader = nil
        slot.rejectPending(message)
    }

    fileprivate func emit(_ event: String, slot id: String) {
        notifyListeners(event, data: ["slot": id])
    }
}

private final class AdSlot: NSObject, NativeAdLoaderDelegate, NativeAdDelegate {
    let id: String
    weak var plugin: RoamNativeAdPlugin?
    var loader: AdLoader?
    var ad: NativeAd?
    var card: RoamAdCardView?
    var pending: [CAPPluginCall] = []

    init(id: String, plugin: RoamNativeAdPlugin) {
        self.id = id
        self.plugin = plugin
    }

    func rejectPending(_ message: String) {
        pending.forEach { $0.reject(message) }
        pending = []
    }

    func adLoader(_ adLoader: AdLoader, didReceive nativeAd: NativeAd) {
        nativeAd.delegate = self
        nativeAd.rootViewController = plugin?.bridge?.viewController
        ad = nativeAd
        loader = nil
        pending.forEach { $0.resolve(["slot": id]) }
        pending = []
    }

    func adLoader(_ adLoader: AdLoader, didFailToReceiveAdWithError error: Error) {
        plugin?.loadFailed(id, message: error.localizedDescription)
    }

    func nativeAdDidRecordImpression(_ nativeAd: NativeAd) {
        plugin?.emit("adImpression", slot: id)
    }

    func nativeAdDidRecordClick(_ nativeAd: NativeAd) {
        plugin?.emit("adClicked", slot: id)
    }
}

private func hex(_ v: UInt32) -> UIColor {
    UIColor(red: CGFloat((v >> 16) & 0xff) / 255, green: CGFloat((v >> 8) & 0xff) / 255,
            blue: CGFloat(v & 0xff) / 255, alpha: 1)
}

private final class RoamAdCardView: UIView {
    var onDismiss: ((String) -> Void)?

    private let clip = UIView()
    private let adView = NativeAdView()
    private let media = MediaView()
    private let pill = UILabel()
    private let advertiser = UILabel()
    private let headline = UILabel()
    private let body = UILabel()
    private let cta = UIButton(type: .custom)
    private let skip = UIButton(type: .custom)
    private var dark: Bool?
    private var dragging = false
    private var dismissing = false

    private static let radius: CGFloat = 24
    private let headlineText: String
    private let ad: NativeAd

    private static func headlineFont(_ size: CGFloat) -> UIFont {
        let base = UIFont.systemFont(ofSize: size, weight: .medium)
        guard let serif = base.fontDescriptor.withDesign(.serif) else { return base }
        return UIFont(descriptor: serif, size: size)
    }

    private static func headlineAttributes(_ size: CGFloat) -> [NSAttributedString.Key: Any] {
        let style = NSMutableParagraphStyle()
        style.minimumLineHeight = size * 1.15
        style.maximumLineHeight = size * 1.15
        style.lineBreakMode = .byTruncatingTail
        return [.font: headlineFont(size), .paragraphStyle: style]
    }

    init(ad: NativeAd) {
        headlineText = ad.headline ?? ""
        self.ad = ad
        super.init(frame: .zero)
        layer.shadowColor = UIColor(red: 42 / 255, green: 37 / 255, blue: 32 / 255, alpha: 1).cgColor
        layer.shadowOpacity = 0.12
        layer.shadowOffset = CGSize(width: 0, height: 8)
        layer.shadowRadius = 12

        clip.layer.cornerRadius = Self.radius
        clip.layer.cornerCurve = .continuous
        clip.layer.borderWidth = 1
        clip.clipsToBounds = true
        addSubview(clip)
        clip.addSubview(adView)

        media.clipsToBounds = true
        media.layer.cornerRadius = 16
        media.layer.cornerCurve = .continuous
        media.mediaContent = ad.mediaContent
        // Documented MediaView API: contentMode scales image media; set it after mediaContent.
        media.contentMode = ad.mediaContent.hasVideoContent ? .scaleAspectFit : .scaleAspectFill

        pill.text = "Sponsored"
        pill.font = .systemFont(ofSize: 12, weight: .semibold)
        pill.textAlignment = .center
        pill.layer.cornerRadius = 11
        pill.clipsToBounds = true

        advertiser.font = .systemFont(ofSize: 13)
        advertiser.lineBreakMode = .byTruncatingTail
        advertiser.text = ad.advertiser


        body.font = .systemFont(ofSize: 15)
        body.numberOfLines = 2
        body.lineBreakMode = .byTruncatingTail
        body.text = ad.body
        body.isHidden = ad.body == nil

        cta.setTitle(ad.callToAction, for: .normal)
        cta.setTitleColor(.white, for: .normal)
        cta.titleLabel?.font = .systemFont(ofSize: 15, weight: .semibold)
        cta.backgroundColor = hex(0x1a3a2f)
        cta.layer.cornerRadius = 22
        cta.isUserInteractionEnabled = false // the SDK handles the click
        cta.isHidden = ad.callToAction == nil

        [media, pill, advertiser, headline, body, cta].forEach(adView.addSubview)
        adView.mediaView = media
        adView.headlineView = headline
        adView.bodyView = body
        adView.advertiserView = advertiser
        adView.callToActionView = cta

        // Sibling of the ad view so our control never counts as an ad click.
        skip.setImage(UIImage(systemName: "xmark", withConfiguration: UIImage.SymbolConfiguration(pointSize: 18, weight: .medium)), for: .normal)
        skip.layer.cornerRadius = 22
        skip.layer.borderWidth = 1
        skip.accessibilityLabel = "Skip ad"
        skip.addTarget(self, action: #selector(onSkip), for: .touchUpInside)
        clip.addSubview(skip)

        // UIKit's pan hysteresis (about 10pt) is the slop; cancelsTouchesInView defaults to true.
        addGestureRecognizer(UIPanGestureRecognizer(target: self, action: #selector(onPan(_:))))
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    func apply(dark: Bool) {
        guard self.dark != dark else { return }
        self.dark = dark
        let ink = hex(dark ? 0xf4ecdc : 0x1a3a2f)
        let line = hex(dark ? 0x1f3a30 : 0xede7dc)
        let soft = hex(dark ? 0x142822 : 0xf7f3ed)
        let text = hex(dark ? 0xd0c5b0 : 0x4a443d)
        clip.backgroundColor = hex(dark ? 0x1f3a30 : 0xffffff)
        clip.layer.borderColor = line.cgColor
        media.backgroundColor = hex(dark ? 0x142822 : 0xede7dc)
        pill.backgroundColor = soft
        pill.textColor = text
        advertiser.textColor = hex(dark ? 0x8a8275 : 0x8a847c)
        headline.textColor = ink
        body.textColor = text
        skip.backgroundColor = soft
        skip.layer.borderColor = line.cgColor
        skip.tintColor = ink
        // Forest disappears on the dark card, so dark mode uses gold with forest text
        cta.backgroundColor = hex(dark ? 0xd4a855 : 0x1a3a2f)
        cta.setTitleColor(dark ? hex(0x1a3a2f) : .white, for: .normal)
    }

    func place(_ frame: CGRect) {
        guard !dragging, !dismissing else { return }
        layer.removeAllAnimations()
        transform = .identity
        alpha = 1
        self.frame = frame
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        let w = bounds.width, h = bounds.height
        clip.frame = bounds
        // Inset so the SDK's top-right AdChoices sits clear of the card's 24pt corner.
        let inset: CGFloat = 8
        adView.frame = clip.bounds.insetBy(dx: inset, dy: inset)
        layer.shadowPath = UIBezierPath(roundedRect: bounds, cornerRadius: Self.radius).cgPath

        // Frames below are in card coordinates; views inside the ad view are shifted by the inset.
        func adFrame(_ rect: CGRect) -> CGRect { rect.offsetBy(dx: -inset, dy: -inset) }

        let x: CGFloat = 20, width = w - 40
        let rowTop = h - 20 - 44
        skip.frame = CGRect(x: 20, y: rowTop, width: 44, height: 44)
        let ctaWidth = min(ceil(cta.titleLabel?.intrinsicContentSize.width ?? 0) + 40, width - 44 - 12)
        cta.frame = adFrame(CGRect(x: w - 20 - ctaWidth, y: rowTop, width: ctaWidth, height: 44))

        // Policy: the headline always shows at least 25 characters untruncated. It is sized first
        // (24pt, 2 lines; smaller only if the card is too narrow), then the media shrinks from 56%
        // towards its minimum, then the body drops. AdMob wants the media at least 120x120pt.
        let rowGap: CGFloat = 6, textGap: CGFloat = 8
        let minMedia = min(h * 0.56, max(120, h * 0.38))
        let (size, lines) = fitHeadline(width: width, available: rowTop - textGap - (inset + minMedia + 16 + 22 + rowGap))
        headline.attributedText = NSAttributedString(string: headlineText, attributes: Self.headlineAttributes(size))
        headline.numberOfLines = lines
        let headlineHeight = ceil(headline.sizeThatFits(CGSize(width: width, height: .greatestFiniteMagnitude)).height)
        let belowMedia = 16 + 22 + rowGap + headlineHeight + textGap + (h - rowTop)
        let mediaHeight = max(0, floor(min(h * 0.56, h - inset - belowMedia)))
        media.frame = adFrame(CGRect(x: inset, y: inset, width: w - 2 * inset, height: mediaHeight))

        var y = inset + mediaHeight + 16
        let pillWidth = ceil(pill.intrinsicContentSize.width) + 20
        pill.frame = adFrame(CGRect(x: x, y: y, width: pillWidth, height: 22))
        let advertiserX = x + pillWidth + 8
        advertiser.frame = adFrame(CGRect(x: advertiserX, y: y, width: max(0, x + width - advertiserX), height: 22))
        y += 22 + rowGap

        headline.frame = adFrame(CGRect(x: x, y: y, width: width, height: headlineHeight))
        y += headlineHeight + 6

        let lineHeight = body.font.lineHeight
        body.numberOfLines = max(0, min(2, Int((rowTop - textGap - y) / lineHeight)))
        body.alpha = body.numberOfLines == 0 ? 0 : 1 // numberOfLines 0 would mean unlimited
        body.frame = adFrame(CGRect(x: x, y: y, width: width, height: lineHeight * CGFloat(body.numberOfLines)))

        // Register only once laid out on screen, so the SDK tracks the ad from when it is visible.
        if adView.nativeAd == nil, window != nil, !bounds.isEmpty {
            adView.nativeAd = ad
        }
    }

    override func didMoveToWindow() {
        super.didMoveToWindow()
        if window != nil { setNeedsLayout() }
    }

    // Largest size (24 down to 16) whose lines fit `available` while the first 25 characters stay
    // whole. Measures through the end of the word holding character 25 plus the ellipsis, word
    // wrapped like the label, because the label wraps whole words before truncating.
    private func fitHeadline(width: CGFloat, available: CGFloat) -> (CGFloat, Int) {
        var measured = headlineText
        if headlineText.count > 25 {
            let rest = headlineText.dropFirst(25)
            measured = String(headlineText[..<(rest.firstIndex(where: { $0.isWhitespace }) ?? rest.endIndex)]) + "\u{2026}"
        }
        var fallback = 2
        for size in stride(from: CGFloat(24), through: 16, by: -1) {
            let attributes = Self.headlineAttributes(size)
            (attributes[.paragraphStyle] as? NSMutableParagraphStyle)?.lineBreakMode = .byWordWrapping
            let height = (measured as NSString).boundingRect(with: CGSize(width: width, height: .greatestFiniteMagnitude),
                                                             options: [.usesLineFragmentOrigin],
                                                             attributes: attributes, context: nil).height
            let needed = Int((height / (size * 1.15)).rounded(.up))
            let lines = headlineText.count > 25 ? max(2, needed) : needed
            if CGFloat(lines) * size * 1.15 <= available { return (size, lines) }
            fallback = lines
        }
        return (16, fallback) // too small a card: keep the text whole and let the media give way
    }

    @objc private func onSkip() { flyOff("left") }

    @objc private func onPan(_ pan: UIPanGestureRecognizer) {
        guard !dismissing else { return }
        let t = pan.translation(in: superview)
        switch pan.state {
        case .began, .changed:
            dragging = true
            let degrees = UIAccessibility.isReduceMotionEnabled ? 0 : t.x / 20
            transform = CGAffineTransform(translationX: t.x, y: t.y).rotated(by: degrees * .pi / 180)
        case .ended, .cancelled, .failed:
            dragging = false
            let vx = pan.velocity(in: superview).x
            if pan.state == .ended && (abs(t.x) > 100 || abs(vx) > 800) {
                flyOff((abs(vx) > 800 ? vx : t.x) < 0 ? "left" : "right")
            } else if UIAccessibility.isReduceMotionEnabled {
                UIView.animate(withDuration: 0.2) { self.transform = .identity }
            } else {
                UIView.animate(withDuration: 0.4, delay: 0, usingSpringWithDamping: 0.7, initialSpringVelocity: 0,
                               options: [.allowUserInteraction]) { self.transform = .identity }
            }
        default:
            break
        }
    }

    private func flyOff(_ direction: String) {
        guard !dismissing else { return }
        dismissing = true
        isUserInteractionEnabled = false
        let sign: CGFloat = direction == "left" ? -1 : 1
        let travel = (superview?.bounds.width ?? UIScreen.main.bounds.width) + bounds.width
        let angle = atan2(transform.b, transform.a)
        let ty = transform.ty
        UIView.animate(withDuration: 0.25, delay: 0, options: [.curveEaseIn], animations: {
            if UIAccessibility.isReduceMotionEnabled {
                self.alpha = 0
            } else {
                self.transform = CGAffineTransform(translationX: sign * travel, y: ty).rotated(by: angle)
            }
        }, completion: { _ in
            self.removeFromSuperview()
            self.onDismiss?(direction)
        })
    }
}

