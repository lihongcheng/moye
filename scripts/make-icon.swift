import AppKit
import Foundation

// Vector-drawn macOS app icon; no external image assets or fonts are required.
let destination = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "resources"
let root = URL(fileURLWithPath: destination, isDirectory: true)
let iconset = root.appendingPathComponent("icon.iconset", isDirectory: true)
try FileManager.default.createDirectory(at: iconset, withIntermediateDirectories: true)
let image = NSImage(size: NSSize(width: 1024, height: 1024))
image.lockFocus()
let background = NSBezierPath(roundedRect: NSRect(x: 48, y: 48, width: 928, height: 928), xRadius: 204, yRadius: 204)
NSGradient(starting: NSColor(srgbRed: 0.31, green: 0.51, blue: 0.45, alpha: 1),
           ending: NSColor(srgbRed: 0.16, green: 0.32, blue: 0.29, alpha: 1))!.draw(in: background, angle: -90)
let page = NSBezierPath(roundedRect: NSRect(x: 260, y: 210, width: 504, height: 626), xRadius: 48, yRadius: 48)
NSColor(srgbRed: 0.96, green: 0.95, blue: 0.89, alpha: 1).setFill()
page.fill()
let ink = NSColor(srgbRed: 0.22, green: 0.41, blue: 0.35, alpha: 1)
// Three lines of writing, with a nib as the final stroke.
for (y, width) in [(678.0, 270.0), (570.0, 220.0), (462.0, 152.0)] {
    ink.setFill()
    NSBezierPath(roundedRect: NSRect(x: 346, y: y, width: width, height: 30), xRadius: 15, yRadius: 15).fill()
}
let nib = NSBezierPath()
nib.move(to: NSPoint(x: 686, y: 530))
nib.line(to: NSPoint(x: 797, y: 419))
nib.line(to: NSPoint(x: 594, y: 259))
nib.line(to: NSPoint(x: 535, y: 238))
nib.line(to: NSPoint(x: 556, y: 297))
nib.close()
ink.setFill()
nib.fill()
NSColor(srgbRed: 0.75, green: 0.85, blue: 0.69, alpha: 1).setStroke()
let split = NSBezierPath()
split.move(to: NSPoint(x: 568, y: 273))
split.line(to: NSPoint(x: 686, y: 391))
split.lineWidth = 9
split.stroke()
image.unlockFocus()
for size in [16, 32, 128, 256, 512] {
    for scale in [1, 2] {
        let pixels = size * scale
        let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: pixels, pixelsHigh: pixels,
            bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
            colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: bitmap)
        NSGraphicsContext.current?.imageInterpolation = .high
        image.draw(in: NSRect(x: 0, y: 0, width: pixels, height: pixels))
        NSGraphicsContext.restoreGraphicsState()
        let suffix = scale == 2 ? "@2x" : ""
        try bitmap.representation(using: .png, properties: [:])!.write(
            to: iconset.appendingPathComponent("icon_\(size)x\(size)\(suffix).png"))
    }
}
let task = Process()
task.executableURL = URL(fileURLWithPath: "/usr/bin/iconutil")
task.arguments = ["-c", "icns", iconset.path, "-o", root.appendingPathComponent("icon.icns").path]
try task.run()
task.waitUntilExit()
guard task.terminationStatus == 0 else { fatalError("iconutil failed") }
try FileManager.default.removeItem(at: iconset)
print("Created \(root.appendingPathComponent("icon.icns").path)")
