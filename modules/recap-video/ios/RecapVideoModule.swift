// Writes the event recap to a 1080×1920 MP4 on the phone: the same scenes
// the in-app player shows (title card, photos with a slow zoom and drift and
// a caption, the end card), cross-faded, at 30 frames a second. Nothing is
// sent anywhere; the file lands in the app's caches folder for sharing or
// saving.

import AVFoundation
import ExpoModulesCore
import UIKit

struct RecapSceneRecord: Record {
  @Field var kind: String = "photo"
  @Field var ms: Double = 2400
  @Field var uri: String? = nil
  @Field var fromScale: Double = 1.04
  @Field var toScale: Double = 1.12
  @Field var fromX: Double = 0
  @Field var toX: Double = 0
  @Field var fromY: Double = 0
  @Field var toY: Double = 0
  @Field var title: String? = nil
  @Field var subtitle: String? = nil
  @Field var caption: String? = nil
}

struct RecapExportOptions: Record {
  @Field var scenes: [RecapSceneRecord] = []
  @Field var markUri: String? = nil
  @Field var fileName: String = "Recap"
  @Field var fadeMs: Double = 450
}

public class RecapVideoModule: Module {
  public func definition() -> ModuleDefinition {
    Name("RecapVideo")

    AsyncFunction("exportAsync") { (options: RecapExportOptions, promise: Promise) in
      // Rendering takes a while; keep it off the JS thread and the main one.
      DispatchQueue.global(qos: .userInitiated).async {
        do {
          let url = try RecapRenderer(options: options).render()
          promise.resolve(url.absoluteString)
        } catch {
          promise.reject("ERR_RECAP_VIDEO", error.localizedDescription)
        }
      }
    }
  }
}

private struct RecapError: LocalizedError {
  let message: String
  var errorDescription: String? { message }
}

private final class RecapRenderer {
  private let W = 1080
  private let H = 1920
  private let fps: Int32 = 30
  private let options: RecapExportOptions
  private var images: [Int: UIImage] = [:]
  private var mark: UIImage?

  // Sizes in output pixels; the app's points × about 2.7 (1080 / 402).
  private let pad: CGFloat = 64
  private let coral = UIColor(red: 240 / 255, green: 153 / 255, blue: 123 / 255, alpha: 1)
  private let filmInk = UIColor(red: 33 / 255, green: 28 / 255, blue: 25 / 255, alpha: 1)

  init(options: RecapExportOptions) {
    self.options = options
  }

  func render() throws -> URL {
    let scenes = options.scenes
    if scenes.isEmpty { throw RecapError(message: "There are no photos to put in the video.") }

    // Pictures first, each shrunk to just over the frame so drawing is quick.
    for (i, scene) in scenes.enumerated() {
      if let uri = scene.uri, let img = loadImage(uri) {
        images[i] = prepared(img, cover: CGSize(width: CGFloat(W) * 1.25, height: CGFloat(H) * 1.25))
      }
    }
    if let m = options.markUri { mark = loadImage(m) }

    let out = try outputURL()
    let writer = try AVAssetWriter(outputURL: out, fileType: .mp4)
    let settings: [String: Any] = [
      AVVideoCodecKey: AVVideoCodecType.h264,
      AVVideoWidthKey: W,
      AVVideoHeightKey: H,
      AVVideoCompressionPropertiesKey: [
        AVVideoAverageBitRateKey: 8_000_000,
        AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel,
      ],
    ]
    let input = AVAssetWriterInput(mediaType: .video, outputSettings: settings)
    input.expectsMediaDataInRealTime = false
    let adaptor = AVAssetWriterInputPixelBufferAdaptor(
      assetWriterInput: input,
      sourcePixelBufferAttributes: [
        kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
        kCVPixelBufferWidthKey as String: W,
        kCVPixelBufferHeightKey as String: H,
      ]
    )
    guard writer.canAdd(input) else { throw RecapError(message: "Couldn't start the video.") }
    writer.add(input)
    guard writer.startWriting() else {
      throw RecapError(message: writer.error?.localizedDescription ?? "Couldn't start the video.")
    }
    writer.startSession(atSourceTime: .zero)

    // Where each scene starts, in ms.
    var starts: [Double] = []
    var total: Double = 0
    for s in scenes {
      starts.append(total)
      total += max(1, s.ms)
    }
    let frames = Int((total / 1000) * Double(fps))

    for f in 0..<frames {
      try autoreleasepool {
        while !input.isReadyForMoreMediaData {
          if writer.status == .failed { throw RecapError(message: writer.error?.localizedDescription ?? "The video failed.") }
          Thread.sleep(forTimeInterval: 0.003)
        }
        guard let pool = adaptor.pixelBufferPool else { throw RecapError(message: "Couldn't make a frame.") }
        var buffer: CVPixelBuffer?
        CVPixelBufferPoolCreatePixelBuffer(nil, pool, &buffer)
        guard let pb = buffer else { throw RecapError(message: "Couldn't make a frame.") }

        CVPixelBufferLockBaseAddress(pb, [])
        defer { CVPixelBufferUnlockBaseAddress(pb, []) }
        guard let ctx = CGContext(
          data: CVPixelBufferGetBaseAddress(pb),
          width: W,
          height: H,
          bitsPerComponent: 8,
          bytesPerRow: CVPixelBufferGetBytesPerRow(pb),
          space: CGColorSpaceCreateDeviceRGB(),
          bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue
        ) else { throw RecapError(message: "Couldn't make a frame.") }

        // UIKit's top-left origin, so images and text draw the right way up.
        ctx.translateBy(x: 0, y: CGFloat(H))
        ctx.scaleBy(x: 1, y: -1)
        UIGraphicsPushContext(ctx)
        ctx.setFillColor(UIColor.black.cgColor)
        ctx.fill(CGRect(x: 0, y: 0, width: W, height: H))

        let t = Double(f) * 1000 / Double(fps)
        var i = starts.count - 1
        while i > 0 && starts[i] > t { i -= 1 }
        let local = t - starts[i]
        let progress = CGFloat(min(1, local / max(1, scenes[i].ms)))
        let fade = options.fadeMs

        if local < fade {
          // Cross-fade: the scene before (held at its end) under this one.
          if i > 0 { drawScene(i - 1, scenes[i - 1], progress: 1, ctx: ctx, caption: false) }
          ctx.saveGState()
          ctx.setAlpha(CGFloat(local / fade))
          ctx.beginTransparencyLayer(auxiliaryInfo: nil)
          drawScene(i, scenes[i], progress: progress, ctx: ctx)
          ctx.endTransparencyLayer()
          ctx.restoreGState()
        } else {
          drawScene(i, scenes[i], progress: progress, ctx: ctx)
        }
        UIGraphicsPopContext()

        if !adaptor.append(pb, withPresentationTime: CMTime(value: CMTimeValue(f), timescale: fps)) {
          throw RecapError(message: writer.error?.localizedDescription ?? "The video failed.")
        }
      }
    }

    input.markAsFinished()
    let done = DispatchSemaphore(value: 0)
    writer.finishWriting { done.signal() }
    done.wait()
    if writer.status != .completed {
      throw RecapError(message: writer.error?.localizedDescription ?? "The video failed.")
    }
    return out
  }

  // MARK: drawing

  // caption: false for the scene underneath a cross-fade, so two captions
  // never overlap.
  private func drawScene(_ index: Int, _ s: RecapSceneRecord, progress p: CGFloat, ctx: CGContext, caption showCaption: Bool = true) {
    let frame = CGRect(x: 0, y: 0, width: W, height: H)
    switch s.kind {
    case "end":
      ctx.setFillColor(filmInk.cgColor)
      ctx.fill(frame)
      let side: CGFloat = 260
      var y = CGFloat(H) / 2 - 300
      if let m = mark {
        let r = CGRect(x: (CGFloat(W) - side) / 2, y: y, width: side, height: side)
        ctx.saveGState()
        UIBezierPath(roundedRect: r, cornerRadius: 58).addClip()
        m.draw(in: r)
        ctx.restoreGState()
        y += side + 60
      }
      y += drawText(s.title ?? "", font: font("Figtree-Bold", 84, .bold), color: .white,
                    in: CGRect(x: pad, y: y, width: CGFloat(W) - pad * 2, height: 240), center: true)
      _ = drawText("Made with RollCal", font: font("Figtree-Medium", 40, .medium),
                   color: UIColor.white.withAlphaComponent(0.85),
                   in: CGRect(x: pad, y: y + 24, width: CGFloat(W) - pad * 2, height: 80), center: true)

    default:
      if let img = images[index] {
        let k = s.kind == "photo"
          ? CGFloat(s.fromScale) + (CGFloat(s.toScale) - CGFloat(s.fromScale)) * p
          : 1.04 + 0.08 * p
        let dx = s.kind == "photo" ? (CGFloat(s.fromX) + (CGFloat(s.toX) - CGFloat(s.fromX)) * p) * CGFloat(W) : 0
        let dy = s.kind == "photo" ? (CGFloat(s.fromY) + (CGFloat(s.toY) - CGFloat(s.fromY)) * p) * CGFloat(H) : 0
        let cover = coverRect(img.size, in: frame.size)
        let w = cover.width * k
        let h = cover.height * k
        img.draw(in: CGRect(x: (CGFloat(W) - w) / 2 + dx, y: (CGFloat(H) - h) / 2 + dy, width: w, height: h))
      } else {
        ctx.setFillColor(UIColor(white: 0.12, alpha: 1).cgColor)
        ctx.fill(frame)
      }

      if s.kind == "title" {
        ctx.setFillColor(UIColor.black.withAlphaComponent(0.38).cgColor)
        ctx.fill(frame)
        let width = CGFloat(W) - pad * 2
        let titleFont = font("Figtree-Bold", 108, .bold)
        let titleH = textHeight(s.title ?? "", font: titleFont, width: width)
        let subFont = font("Figtree-Medium", 43, .medium)
        let subH = (s.subtitle?.isEmpty ?? true) ? 0 : textHeight(s.subtitle!, font: subFont, width: width) + 20
        var y = CGFloat(H) - 260 - subH - titleH - 60
        y += drawText("RECAP", font: font("Figtree-SemiBold", 35, .semibold), color: coral,
                      in: CGRect(x: pad, y: y, width: width, height: 60), kern: 5)
        y += 20
        y += drawText(s.title ?? "", font: titleFont, color: .white, in: CGRect(x: pad, y: y, width: width, height: titleH))
        if let sub = s.subtitle, !sub.isEmpty {
          _ = drawText(sub, font: subFont, color: UIColor.white.withAlphaComponent(0.85),
                       in: CGRect(x: pad, y: y + 20, width: width, height: subH))
        }
      } else if showCaption, let caption = s.caption, !caption.isEmpty {
        // A soft shade along the bottom, then the caption on it.
        let shadeH: CGFloat = 520
        let colors = [UIColor.black.withAlphaComponent(0).cgColor, UIColor.black.withAlphaComponent(0.55).cgColor] as CFArray
        if let g = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(), colors: colors, locations: [0, 1]) {
          ctx.drawLinearGradient(g, start: CGPoint(x: 0, y: CGFloat(H) - shadeH), end: CGPoint(x: 0, y: CGFloat(H)), options: [])
        }
        // The caption, and under it who took it and when (when the caption
        // is an AI one; otherwise that line is the caption).
        let width = CGFloat(W) - pad * 2
        let f = font("Figtree-SemiBold", 46, .semibold)
        let h = textHeight(caption, font: f, width: width)
        let metaFont = font("Figtree-Medium", 34, .medium)
        let meta = s.subtitle ?? ""
        let metaH = meta.isEmpty ? 0 : textHeight(meta, font: metaFont, width: width) + 6
        let top = CGFloat(H) - 190 - metaH - h
        _ = drawText(caption, font: f, color: .white, in: CGRect(x: pad, y: top, width: width, height: h))
        if !meta.isEmpty {
          _ = drawText(meta, font: metaFont, color: UIColor.white.withAlphaComponent(0.85),
                       in: CGRect(x: pad, y: top + h + 6, width: width, height: metaH))
        }
      }
    }
  }

  @discardableResult
  private func drawText(_ text: String, font: UIFont, color: UIColor, in rect: CGRect,
                        center: Bool = false, kern: CGFloat = 0) -> CGFloat {
    let para = NSMutableParagraphStyle()
    para.alignment = center ? .center : .left
    para.lineBreakMode = .byWordWrapping
    let attrs: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: color, .paragraphStyle: para, .kern: kern]
    let s = NSAttributedString(string: text, attributes: attrs)
    let size = s.boundingRect(with: CGSize(width: rect.width, height: rect.height),
                              options: [.usesLineFragmentOrigin, .usesFontLeading], context: nil)
    s.draw(with: CGRect(x: rect.minX, y: rect.minY, width: rect.width, height: ceil(size.height)),
           options: [.usesLineFragmentOrigin, .usesFontLeading], context: nil)
    return ceil(size.height)
  }

  private func textHeight(_ text: String, font: UIFont, width: CGFloat) -> CGFloat {
    let s = NSAttributedString(string: text, attributes: [.font: font])
    return ceil(s.boundingRect(with: CGSize(width: width, height: 2000),
                               options: [.usesLineFragmentOrigin, .usesFontLeading], context: nil).height)
  }

  private func font(_ name: String, _ size: CGFloat, _ weight: UIFont.Weight) -> UIFont {
    UIFont(name: name, size: size) ?? UIFont.systemFont(ofSize: size, weight: weight)
  }

  // MARK: images and files

  private func coverRect(_ img: CGSize, in box: CGSize) -> CGSize {
    guard img.width > 0, img.height > 0 else { return box }
    let s = max(box.width / img.width, box.height / img.height)
    return CGSize(width: img.width * s, height: img.height * s)
  }

  private func loadImage(_ uri: String) -> UIImage? {
    if uri.hasPrefix("http://") || uri.hasPrefix("https://") {
      guard let url = URL(string: uri), let data = try? Data(contentsOf: url) else { return nil }
      return UIImage(data: data)
    }
    let path = uri.hasPrefix("file://") ? (URL(string: uri)?.path ?? uri) : uri
    return UIImage(contentsOfFile: path)
  }

  // The picture redrawn once at about the size it's shown, upright.
  private func prepared(_ img: UIImage, cover box: CGSize) -> UIImage {
    let size = coverRect(img.size, in: box)
    if size.width >= img.size.width && img.imageOrientation == .up { return img }
    let format = UIGraphicsImageRendererFormat()
    format.scale = 1
    format.opaque = true
    return UIGraphicsImageRenderer(size: size, format: format).image { _ in
      img.draw(in: CGRect(origin: .zero, size: size))
    }
  }

  private func outputURL() throws -> URL {
    let dir = try FileManager.default.url(for: .cachesDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
    let bad = CharacterSet(charactersIn: "\\/:*?\"<>|").union(.controlCharacters)
    var name = options.fileName.components(separatedBy: bad).joined().trimmingCharacters(in: .whitespaces)
    if name.isEmpty { name = "RollCal recap" }
    let url = dir.appendingPathComponent(String(name.prefix(80)) + ".mp4")
    try? FileManager.default.removeItem(at: url)
    return url
  }
}
