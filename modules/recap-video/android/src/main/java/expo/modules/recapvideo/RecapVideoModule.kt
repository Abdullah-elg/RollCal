// Android twin of ios/RecapVideoModule.swift: writes the event recap to a
// 1080x1920 MP4 on the phone. Same scenes as the in-app player (title card,
// photos with a slow zoom and drift and a caption, the end card),
// cross-faded, at 30 frames a second. Nothing is sent anywhere; the file
// lands in the app's cache folder for sharing or saving.
//
// Each frame is drawn with Canvas into a Bitmap, uploaded to an OpenGL
// texture and drawn onto the encoder's input surface, so each frame gets an
// exact timestamp (eglPresentationTimeANDROID). MediaCodec encodes H.264 and
// MediaMuxer writes the MP4.

package expo.modules.recapvideo

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.graphics.Shader
import android.graphics.Typeface
import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaFormat
import android.media.MediaMuxer
import android.opengl.EGL14
import android.opengl.EGLConfig
import android.opengl.EGLContext
import android.opengl.EGLDisplay
import android.opengl.EGLExt
import android.opengl.EGLSurface
import android.opengl.GLES20
import android.opengl.GLUtils
import android.text.Layout
import android.text.StaticLayout
import android.text.TextPaint
import android.view.Surface
import com.facebook.react.common.assets.ReactFontManager
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import java.io.File
import java.net.URL
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.FloatBuffer
import kotlin.math.ceil
import kotlin.math.max
import kotlin.math.min

class RecapSceneRecord : Record {
  @Field var kind: String = "photo"
  @Field var ms: Double = 2400.0
  @Field var uri: String? = null
  @Field var fromScale: Double = 1.04
  @Field var toScale: Double = 1.12
  @Field var fromX: Double = 0.0
  @Field var toX: Double = 0.0
  @Field var fromY: Double = 0.0
  @Field var toY: Double = 0.0
  @Field var title: String? = null
  @Field var subtitle: String? = null
  @Field var caption: String? = null
}

class RecapExportOptions : Record {
  @Field var scenes: List<RecapSceneRecord> = emptyList()
  @Field var markUri: String? = null
  @Field var fileName: String = "Recap"
  @Field var fadeMs: Double = 450.0
}

class RecapVideoModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("RecapVideo")

    AsyncFunction("exportAsync") { options: RecapExportOptions, promise: Promise ->
      // Rendering takes a while; keep it off the JS and main threads.
      Thread {
        try {
          val context = appContext.reactContext ?: throw IllegalStateException("The app isn't ready.")
          val file = RecapRenderer(options, context).render()
          promise.resolve("file://" + file.absolutePath)
        } catch (e: Throwable) {
          promise.reject("ERR_RECAP_VIDEO", e.message ?: "The video failed.", e)
        }
      }.start()
    }
  }
}

private class RecapRenderer(
  private val options: RecapExportOptions,
  private val context: android.content.Context,
) {
  private val cacheDir: File = context.cacheDir
  private val assets: android.content.res.AssetManager = context.assets
  private val w = 1080
  private val h = 1920
  private val fps = 30
  private val pad = 64f
  private val coral = Color.rgb(240, 153, 123)
  private val filmInk = Color.rgb(33, 28, 25)
  private val images = HashMap<Int, Bitmap>()
  private var mark: Bitmap? = null

  fun render(): File {
    val scenes = options.scenes
    if (scenes.isEmpty()) throw IllegalStateException("There are no photos to put in the video.")

    // Pictures first, each shrunk to just over the frame so drawing is quick.
    scenes.forEachIndexed { i, s ->
      s.uri?.let { uri -> loadImage(uri, (w * 1.25f).toInt(), (h * 1.25f).toInt())?.let { images[i] = it } }
    }
    options.markUri?.let { mark = loadImage(it, 400, 400) }

    val out = outputFile()
    val starts = ArrayList<Double>()
    var total = 0.0
    for (s in scenes) {
      starts.add(total)
      total += max(1.0, s.ms)
    }
    val frames = ((total / 1000.0) * fps).toInt()

    val encoder = Encoder(w, h, fps, out)
    val frame = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(frame)
    try {
      for (f in 0 until frames) {
        val t = f * 1000.0 / fps
        var i = starts.size - 1
        while (i > 0 && starts[i] > t) i--
        val local = t - starts[i]
        val progress = min(1.0, local / max(1.0, scenes[i].ms)).toFloat()
        val fade = options.fadeMs

        canvas.drawColor(Color.BLACK)
        if (local < fade && i > 0) {
          // Cross-fade: the scene before (held at its end) under this one.
          drawScene(canvas, i - 1, scenes[i - 1], 1f, caption = false)
          val alpha = (255 * (local / fade)).toInt().coerceIn(0, 255)
          canvas.saveLayerAlpha(0f, 0f, w.toFloat(), h.toFloat(), alpha)
          drawScene(canvas, i, scenes[i], progress)
          canvas.restore()
        } else {
          drawScene(canvas, i, scenes[i], progress)
        }
        encoder.frame(frame, f.toLong() * 1_000_000_000L / fps)
      }
      encoder.finish()
    } catch (e: Throwable) {
      encoder.release()
      out.delete()
      throw e
    } finally {
      frame.recycle()
      images.values.forEach { it.recycle() }
      mark?.recycle()
    }
    return out
  }

  // ---- drawing --------------------------------------------------------------

  private fun drawScene(c: Canvas, index: Int, s: RecapSceneRecord, p: Float, caption: Boolean = true) {
    val W = w.toFloat()
    val H = h.toFloat()
    if (s.kind == "end") {
      c.drawColor(filmInk)
      val side = 260f
      var y = H / 2 - 300
      mark?.let { m ->
        val r = RectF((W - side) / 2, y, (W + side) / 2, y + side)
        c.save()
        c.clipPath(Path().apply { addRoundRect(r, 58f, 58f, Path.Direction.CW) })
        c.drawBitmap(m, null, r, Paint(Paint.FILTER_BITMAP_FLAG))
        c.restore()
        y += side + 60
      }
      y += drawText(c, s.title ?: "", font("Figtree_700Bold", Typeface.BOLD), 84f, Color.WHITE, pad, y, W - pad * 2, center = true)
      drawText(c, "Made with RollCal", font("Figtree_500Medium", Typeface.NORMAL), 40f,
        Color.argb(217, 255, 255, 255), pad, y + 24, W - pad * 2, center = true)
      return
    }

    val img = images[index]
    if (img != null) {
      val k = if (s.kind == "photo") (s.fromScale + (s.toScale - s.fromScale) * p).toFloat() else 1.04f + 0.08f * p
      val dx = if (s.kind == "photo") ((s.fromX + (s.toX - s.fromX) * p) * W).toFloat() else 0f
      val dy = if (s.kind == "photo") ((s.fromY + (s.toY - s.fromY) * p) * H).toFloat() else 0f
      val cover = max(W / img.width, H / img.height)
      val iw = img.width * cover * k
      val ih = img.height * cover * k
      val left = (W - iw) / 2 + dx
      val top = (H - ih) / 2 + dy
      c.drawBitmap(img, null, RectF(left, top, left + iw, top + ih), Paint(Paint.FILTER_BITMAP_FLAG))
    } else {
      c.drawColor(Color.rgb(31, 31, 31))
    }

    if (s.kind == "title") {
      c.drawColor(Color.argb(97, 0, 0, 0))
      val width = W - pad * 2
      val titleFont = font("Figtree_700Bold", Typeface.BOLD)
      val subFont = font("Figtree_500Medium", Typeface.NORMAL)
      val titleH = textHeight(s.title ?: "", titleFont, 108f, width)
      val sub = s.subtitle.orEmpty()
      val subH = if (sub.isEmpty()) 0f else textHeight(sub, subFont, 43f, width) + 20
      var y = H - 260 - subH - titleH - 60
      y += drawText(c, "R E C A P", font("Figtree_600SemiBold", Typeface.BOLD), 35f, coral, pad, y, width)
      y += 20
      y += drawText(c, s.title ?: "", titleFont, 108f, Color.WHITE, pad, y, width)
      if (sub.isNotEmpty()) drawText(c, sub, subFont, 43f, Color.argb(217, 255, 255, 255), pad, y + 20, width)
    } else if (caption && !s.caption.isNullOrEmpty()) {
      // A soft shade along the bottom, then the caption on it, and under it
      // who took it and when.
      val shadeH = 520f
      val shade = Paint().apply {
        shader = LinearGradient(0f, H - shadeH, 0f, H, Color.argb(0, 0, 0, 0), Color.argb(140, 0, 0, 0), Shader.TileMode.CLAMP)
      }
      c.drawRect(0f, H - shadeH, W, H, shade)
      val width = W - pad * 2
      val capFont = font("Figtree_600SemiBold", Typeface.BOLD)
      val metaFont = font("Figtree_500Medium", Typeface.NORMAL)
      val capText = s.caption!!
      val capH = textHeight(capText, capFont, 46f, width)
      val meta = s.subtitle.orEmpty()
      val metaH = if (meta.isEmpty()) 0f else textHeight(meta, metaFont, 34f, width) + 6
      val top = H - 190 - metaH - capH
      drawText(c, capText, capFont, 46f, Color.WHITE, pad, top, width)
      if (meta.isNotEmpty()) drawText(c, meta, metaFont, 34f, Color.argb(217, 255, 255, 255), pad, top + capH + 6, width)
    }
  }

  private fun layout(text: String, face: Typeface, size: Float, color: Int, width: Float, center: Boolean): StaticLayout {
    val paint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
      typeface = face
      textSize = size
      this.color = color
    }
    return StaticLayout.Builder.obtain(text, 0, text.length, paint, width.toInt())
      .setAlignment(if (center) Layout.Alignment.ALIGN_CENTER else Layout.Alignment.ALIGN_NORMAL)
      .build()
  }

  private fun drawText(c: Canvas, text: String, face: Typeface, size: Float, color: Int,
                       x: Float, y: Float, width: Float, center: Boolean = false): Float {
    val l = layout(text, face, size, color, width, center)
    c.save()
    c.translate(x, y)
    l.draw(c)
    c.restore()
    return ceil(l.height.toFloat())
  }

  private fun textHeight(text: String, face: Typeface, size: Float, width: Float): Float =
    ceil(layout(text, face, size, Color.WHITE, width, false).height.toFloat())

  // The app's Figtree (loaded by expo-font) when it's there, else the system font.
  private val fonts = HashMap<String, Typeface>()
  private fun font(name: String, style: Int): Typeface = fonts.getOrPut(name) {
    try {
      ReactFontManager.getInstance().getTypeface(name, Typeface.NORMAL, assets)
    } catch (_: Throwable) {
      Typeface.create("sans-serif", style)
    }
  }

  // ---- images and files -----------------------------------------------------

  // Decoded at about the size it's shown, upright.
  // http(s) links, file paths, and (in release builds) images bundled with
  // the app, which React Native names by resource ("assets_icon").
  private fun readBytes(uri: String): ByteArray = when {
    uri.startsWith("http://") || uri.startsWith("https://") -> URL(uri).openStream().use { it.readBytes() }
    uri.startsWith("file://") || uri.startsWith("/") -> File(uri.removePrefix("file://")).readBytes()
    uri.startsWith("asset:/") -> assets.open(uri.removePrefix("asset:/").trimStart('/')).use { it.readBytes() }
    else -> {
      val res = context.resources
      val id = res.getIdentifier(uri, "drawable", context.packageName)
        .takeIf { it != 0 } ?: res.getIdentifier(uri, "raw", context.packageName)
      if (id == 0) throw IllegalArgumentException("No image $uri")
      res.openRawResource(id).use { it.readBytes() }
    }
  }

  private fun loadImage(uri: String, minW: Int, minH: Int): Bitmap? = try {
    val bytes = readBytes(uri)
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
    var sample = 1
    while (bounds.outWidth / (sample * 2) >= minW && bounds.outHeight / (sample * 2) >= minH) sample *= 2
    val decoded = BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = sample })
    decoded?.let { upright(it, bytes) }
  } catch (_: Throwable) {
    null
  }

  private fun upright(bmp: Bitmap, bytes: ByteArray): Bitmap {
    val rotation = try {
      val exif = androidx.exifinterface.media.ExifInterface(bytes.inputStream())
      exif.rotationDegrees
    } catch (_: Throwable) {
      0
    }
    if (rotation == 0) return bmp
    val m = android.graphics.Matrix().apply { postRotate(rotation.toFloat()) }
    val turned = Bitmap.createBitmap(bmp, 0, 0, bmp.width, bmp.height, m, true)
    if (turned != bmp) bmp.recycle()
    return turned
  }

  private fun outputFile(): File {
    val bad = Regex("[\\\\/:*?\"<>|\\p{Cntrl}]")
    var name = options.fileName.replace(bad, "").trim()
    if (name.isEmpty()) name = "RollCal recap"
    val file = File(cacheDir, name.take(80) + ".mp4")
    file.delete()
    return file
  }
}

// H.264 encoder fed through an EGL surface, so each frame has its own time.
private class Encoder(private val w: Int, private val h: Int, fps: Int, out: File) {
  private val codec: MediaCodec
  private val muxer = MediaMuxer(out.absolutePath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
  private val input: Surface
  private var track = -1
  private var muxing = false
  private val info = MediaCodec.BufferInfo()

  private var display: EGLDisplay = EGL14.EGL_NO_DISPLAY
  private var context: EGLContext = EGL14.EGL_NO_CONTEXT
  private var surface: EGLSurface = EGL14.EGL_NO_SURFACE
  private var program = 0
  private var texture = 0
  private val quad: FloatBuffer

  init {
    val format = MediaFormat.createVideoFormat(MediaFormat.MIMETYPE_VIDEO_AVC, w, h).apply {
      setInteger(MediaFormat.KEY_COLOR_FORMAT, MediaCodecInfo.CodecCapabilities.COLOR_FormatSurface)
      setInteger(MediaFormat.KEY_BIT_RATE, 8_000_000)
      setInteger(MediaFormat.KEY_FRAME_RATE, fps)
      setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, 1)
    }
    codec = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_VIDEO_AVC)
    codec.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
    input = codec.createInputSurface()
    codec.start()
    setUpGl()
    // Full-screen quad: x, y, u, v (v flipped so the bitmap is upright).
    val v = floatArrayOf(-1f, -1f, 0f, 1f, 1f, -1f, 1f, 1f, -1f, 1f, 0f, 0f, 1f, 1f, 1f, 0f)
    quad = ByteBuffer.allocateDirect(v.size * 4).order(ByteOrder.nativeOrder()).asFloatBuffer().put(v)
    quad.position(0)
  }

  private fun setUpGl() {
    display = EGL14.eglGetDisplay(EGL14.EGL_DEFAULT_DISPLAY)
    val version = IntArray(2)
    check(EGL14.eglInitialize(display, version, 0, version, 1)) { "Couldn't start the video." }
    val attribs = intArrayOf(
      EGL14.EGL_RED_SIZE, 8, EGL14.EGL_GREEN_SIZE, 8, EGL14.EGL_BLUE_SIZE, 8, EGL14.EGL_ALPHA_SIZE, 8,
      EGL14.EGL_RENDERABLE_TYPE, EGL14.EGL_OPENGL_ES2_BIT, EGLExt.EGL_RECORDABLE_ANDROID, 1, EGL14.EGL_NONE,
    )
    val configs = arrayOfNulls<EGLConfig>(1)
    val count = IntArray(1)
    check(EGL14.eglChooseConfig(display, attribs, 0, configs, 0, 1, count, 0) && count[0] > 0) { "Couldn't start the video." }
    context = EGL14.eglCreateContext(display, configs[0], EGL14.EGL_NO_CONTEXT,
      intArrayOf(EGL14.EGL_CONTEXT_CLIENT_VERSION, 2, EGL14.EGL_NONE), 0)
    surface = EGL14.eglCreateWindowSurface(display, configs[0], input, intArrayOf(EGL14.EGL_NONE), 0)
    check(EGL14.eglMakeCurrent(display, surface, surface, context)) { "Couldn't start the video." }

    val vs = """
      attribute vec4 aPos; attribute vec2 aUv; varying vec2 vUv;
      void main() { gl_Position = aPos; vUv = aUv; }
    """.trimIndent()
    val fs = """
      precision mediump float; varying vec2 vUv; uniform sampler2D uTex;
      void main() { gl_FragColor = texture2D(uTex, vUv); }
    """.trimIndent()
    program = GLES20.glCreateProgram().also { p ->
      GLES20.glAttachShader(p, shader(GLES20.GL_VERTEX_SHADER, vs))
      GLES20.glAttachShader(p, shader(GLES20.GL_FRAGMENT_SHADER, fs))
      GLES20.glLinkProgram(p)
    }
    val tex = IntArray(1)
    GLES20.glGenTextures(1, tex, 0)
    texture = tex[0]
    GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, texture)
    GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_MIN_FILTER, GLES20.GL_LINEAR)
    GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_MAG_FILTER, GLES20.GL_LINEAR)
    GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_WRAP_S, GLES20.GL_CLAMP_TO_EDGE)
    GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_WRAP_T, GLES20.GL_CLAMP_TO_EDGE)
  }

  private fun shader(type: Int, src: String): Int = GLES20.glCreateShader(type).also {
    GLES20.glShaderSource(it, src)
    GLES20.glCompileShader(it)
  }

  fun frame(bitmap: Bitmap, timeNs: Long) {
    drain(false)
    GLES20.glViewport(0, 0, w, h)
    GLES20.glUseProgram(program)
    GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, texture)
    GLUtils.texImage2D(GLES20.GL_TEXTURE_2D, 0, bitmap, 0)
    val pos = GLES20.glGetAttribLocation(program, "aPos")
    val uv = GLES20.glGetAttribLocation(program, "aUv")
    quad.position(0)
    GLES20.glVertexAttribPointer(pos, 2, GLES20.GL_FLOAT, false, 16, quad)
    GLES20.glEnableVertexAttribArray(pos)
    quad.position(2)
    GLES20.glVertexAttribPointer(uv, 2, GLES20.GL_FLOAT, false, 16, quad)
    GLES20.glEnableVertexAttribArray(uv)
    GLES20.glDrawArrays(GLES20.GL_TRIANGLE_STRIP, 0, 4)
    EGLExt.eglPresentationTimeANDROID(display, surface, timeNs)
    EGL14.eglSwapBuffers(display, surface)
  }

  fun finish() {
    codec.signalEndOfInputStream()
    drain(true)
    release()
  }

  private fun drain(end: Boolean) {
    while (true) {
      val i = codec.dequeueOutputBuffer(info, 10_000)
      when {
        i == MediaCodec.INFO_TRY_AGAIN_LATER -> if (!end) return
        i == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
          track = muxer.addTrack(codec.outputFormat)
          muxer.start()
          muxing = true
        }
        i >= 0 -> {
          val buf = codec.getOutputBuffer(i)
          if (info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG != 0) info.size = 0
          if (info.size > 0 && muxing && buf != null) {
            buf.position(info.offset)
            buf.limit(info.offset + info.size)
            muxer.writeSampleData(track, buf, info)
          }
          codec.releaseOutputBuffer(i, false)
          if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) return
        }
      }
    }
  }

  fun release() {
    try { codec.stop() } catch (_: Throwable) {}
    codec.release()
    if (muxing) try { muxer.stop() } catch (_: Throwable) {}
    muxer.release()
    if (display != EGL14.EGL_NO_DISPLAY) {
      EGL14.eglMakeCurrent(display, EGL14.EGL_NO_SURFACE, EGL14.EGL_NO_SURFACE, EGL14.EGL_NO_CONTEXT)
      EGL14.eglDestroySurface(display, surface)
      EGL14.eglDestroyContext(display, context)
      EGL14.eglTerminate(display)
      display = EGL14.EGL_NO_DISPLAY
    }
    input.release()
  }
}
