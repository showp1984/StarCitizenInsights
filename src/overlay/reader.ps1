# Reads the text of Star Citizen's on-screen info overlay (r_displayinfo) with Windows' built-in OCR.
# Runs as one long-lived Windows PowerShell 5.1 process so start-up cost is paid once. Commands arrive on stdin,
# one per line; each answer is one JSON line on stdout. A region is given in pixels from the top-right corner,
# where the overlay is drawn:
#   read  <width> <height> <scale> <threshold>          from the Star Citizen window
#   file  <width> <height> <scale> <threshold> <path>   from an image file (screenshots, tests)
#   bench <width> <height> <scale> <threshold>          from the primary screen (timing without the game)
#   again <scale> <threshold>                           the last captured corner once more, cleaned up differently
#   save  <path>                                        the last captured corner as PNG (diagnosis mode)
#   show  -3 <path>                                     the last captured corner as the -3 clean-up sees it (tests)
#   quit
# threshold 0 skips the clean-up; -1 keeps only yellow, orange and red text; -3 keeps only the overlay's own
# text, by its colors and black drop shadow; otherwise pixels at least that bright become black text on white.
# The capture copies screen pixels only (like streaming software); it never touches the game process.

$ErrorActionPreference = 'Stop'
# The console's default code page turns some OCR characters into control bytes; answer in UTF-8.
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.SoftwareBitmap, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.InMemoryRandomAccessStream, Windows.Storage.Streams, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.DataWriter, Windows.Storage.Streams, ContentType = WindowsRuntime]
$null = [Windows.Globalization.Language, Windows.Globalization, ContentType = WindowsRuntime]

Add-Type -ReferencedAssemblies System.Drawing @'
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
public static class Win {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr h, ref Point p);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
}
public static class Prep {
  // Overlay text is bright; turn it black on white, everything else white.
  public static void Binarize(Bitmap bmp, int threshold) {
    var rect = new Rectangle(0, 0, bmp.Width, bmp.Height);
    var data = bmp.LockBits(rect, ImageLockMode.ReadWrite, PixelFormat.Format32bppArgb);
    int bytes = Math.Abs(data.Stride) * bmp.Height;
    var buf = new byte[bytes];
    Marshal.Copy(data.Scan0, buf, 0, bytes);
    for (int i = 0; i < bytes; i += 4) {
      int lum = (buf[i + 2] * 299 + buf[i + 1] * 587 + buf[i] * 114) / 1000;
      byte v = lum >= threshold ? (byte)0 : (byte)255;
      buf[i] = v; buf[i + 1] = v; buf[i + 2] = v; buf[i + 3] = 255;
    }
    Marshal.Copy(buf, 0, data.Scan0, bytes);
    bmp.UnlockBits(data);
  }
  // The overlay's own text, by its colors: white or grey, or yellow, orange and red (bad numbers), each with its
  // black drop shadow one or two pixels to the right and below. Those pixels become dark on white (brighter ink
  // darker, so the font's soft edges and decimal points survive), everything else white: the ship banner's
  // lavender text, the HUD and space behind. Works on the capture at its own size, where the shadow is.
  public static Bitmap Keyed(Bitmap src) {
    var bmp = src.Clone(new Rectangle(0, 0, src.Width, src.Height), PixelFormat.Format32bppArgb);
    var rect = new Rectangle(0, 0, bmp.Width, bmp.Height);
    var data = bmp.LockBits(rect, ImageLockMode.ReadWrite, PixelFormat.Format32bppArgb);
    int stride = Math.Abs(data.Stride), w = bmp.Width, h = bmp.Height;
    var buf = new byte[stride * h];
    Marshal.Copy(data.Scan0, buf, 0, buf.Length);
    var dark = new bool[w * h];
    var ink = new int[w * h];
    var faint = new bool[w * h];
    for (int y = 0; y < h; y++) for (int x = 0; x < w; x++) {
      int i = y * stride + x * 4;
      int b = buf[i], g = buf[i + 1], r = buf[i + 2];
      int max = Math.Max(r, Math.Max(g, b)), min = Math.Min(r, Math.Min(g, b));
      dark[y * w + x] = max <= 60;
      bool grey = min >= 100 && max - min <= 40;
      bool warm = r >= 130 && r - b >= 50 && r >= g - 10;
      ink[y * w + x] = (r * 299 + g * 587 + b * 114) / 1000;
      // The font's soft edges: dimmer, but still grey or warm.
      faint[y * w + x] = (min >= 60 && max - min <= 45) || (r >= 100 && r - b >= 35 && r >= g - 10);
      if (!(grey || warm)) ink[y * w + x] = -ink[y * w + x] - 1;
    }
    var keep = new bool[w * h];
    for (int y = 0; y < h; y++) for (int x = 0; x < w; x++) {
      if (ink[y * w + x] < 0) continue;
      for (int dy = 0; dy <= 2 && !keep[y * w + x]; dy++)
        for (int dx = 0; dx <= 2 && !keep[y * w + x]; dx++)
          if ((dx > 0 || dy > 0) && x + dx < w && y + dy < h && dark[(y + dy) * w + x + dx]) keep[y * w + x] = true;
    }
    for (int y = 0; y < h; y++) for (int x = 0; x < w; x++) {
      bool on = keep[y * w + x];
      // A soft edge pixel next to kept text belongs to the same letter.
      if (!on && faint[y * w + x])
        for (int dy = -1; dy <= 1 && !on; dy++)
          for (int dx = -1; dx <= 1 && !on; dx++)
            if (x + dx >= 0 && y + dy >= 0 && x + dx < w && y + dy < h && keep[(y + dy) * w + x + dx]) on = true;
      int lum = ink[y * w + x] < 0 ? -ink[y * w + x] - 1 : ink[y * w + x];
      int i = y * stride + x * 4;
      byte v = on ? (byte)Math.Max(0, Math.Min(255, 255 - (lum - 50) * 255 / 120)) : (byte)255;
      buf[i] = v; buf[i + 1] = v; buf[i + 2] = v; buf[i + 3] = 255;
    }
    Marshal.Copy(buf, 0, data.Scan0, buf.Length);
    bmp.UnlockBits(data);
    return bmp;
  }
  // Keeps only yellow, orange and red text (lots of red, little blue), dark on white; white text, the grey
  // ship banner and space all turn white. The overlay colors a line this way when its numbers are bad.
  public static void Colored(Bitmap bmp) {
    var rect = new Rectangle(0, 0, bmp.Width, bmp.Height);
    var data = bmp.LockBits(rect, ImageLockMode.ReadWrite, PixelFormat.Format32bppArgb);
    int bytes = Math.Abs(data.Stride) * bmp.Height;
    var buf = new byte[bytes];
    Marshal.Copy(data.Scan0, buf, 0, bytes);
    for (int i = 0; i < bytes; i += 4) {
      int d = Math.Min(buf[i + 2] - buf[i], buf[i + 2] - 90);
      byte v = d >= 110 ? (byte)0 : d <= 40 ? (byte)255 : (byte)(255 - (d - 40) * 255 / 70);
      buf[i] = v; buf[i + 1] = v; buf[i + 2] = v; buf[i + 3] = 255;
    }
    Marshal.Copy(buf, 0, data.Scan0, bytes);
    bmp.UnlockBits(data);
  }
}
'@
[void][Win]::SetProcessDPIAware()

$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
function Await($op, [Type]$type) { $t = $asTask.MakeGenericMethod($type).Invoke($null, @($op)); $t.Wait(); $t.Result }

$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage((New-Object Windows.Globalization.Language 'en-US'))
if (-not $engine) { $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages() }

# The game's client area on screen (borderless and windowed both work).
function Find-Game {
  $p = Get-Process -Name StarCitizen -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
  if (-not $p) { return $null }
  $h = $p.MainWindowHandle
  $r = New-Object Win+RECT
  [void][Win]::GetClientRect($h, [ref]$r)
  $pt = New-Object System.Drawing.Point 0, 0
  [void][Win]::ClientToScreen($h, [ref]$pt)
  @{ minimized = [Win]::IsIconic($h); foreground = ([Win]::GetForegroundWindow() -eq $h)
     left = $pt.X; top = $pt.Y; width = $r.Right - $r.Left; height = $r.Bottom - $r.Top }
}

function Ocr-Bitmap([System.Drawing.Bitmap]$bmp, [double]$scale, [int]$threshold) {
  $sw = [int]($bmp.Width * $scale); $sh = [int]($bmp.Height * $scale)
  $from = if ($threshold -eq -3) { [Prep]::Keyed($bmp) } else { $bmp }
  $big = New-Object System.Drawing.Bitmap $sw, $sh, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($big)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.DrawImage($from, 0, 0, $sw, $sh)
  $g.Dispose()
  if ($threshold -eq -3) { $from.Dispose() }
  if ($threshold -gt 0) { [Prep]::Binarize($big, $threshold) }
  elseif ($threshold -eq -1) { [Prep]::Colored($big) }
  $ms = New-Object System.IO.MemoryStream
  $big.Save($ms, [System.Drawing.Imaging.ImageFormat]::Bmp)
  $big.Dispose()
  $ras = New-Object Windows.Storage.Streams.InMemoryRandomAccessStream
  $writer = New-Object Windows.Storage.Streams.DataWriter ($ras.GetOutputStreamAt(0))
  $writer.WriteBytes($ms.ToArray())
  [void](Await ($writer.StoreAsync()) ([UInt32]))
  $ms.Dispose()
  $decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($ras)) ([Windows.Graphics.Imaging.BitmapDecoder])
  $soft = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
  $res = Await ($engine.RecognizeAsync($soft)) ([Windows.Media.Ocr.OcrResult])
  $soft.Dispose(); $ras.Dispose(); $writer.Dispose()
  # Keep each line's position so lines the OCR splits (colored segments) can be rejoined by height. The height is
  # the middle of the line's words: a line that starts with a dot or dash would otherwise sit half a row too low.
  , @($res.Lines | ForEach-Object {
    $ws = @($_.Words)
    $mids = @($ws | ForEach-Object { $_.BoundingRect.Y + $_.BoundingRect.Height / 2 } | Sort-Object)
    # OCR can return control characters, which Windows PowerShell's JSON writer leaves unescaped.
    @{ text = ($_.Text -replace '[\x00-\x1F\x7F]', ' '); y = [int]($mids[[int][Math]::Floor(($mids.Count - 1) / 2)] / $scale); x = [int]($ws[0].BoundingRect.X / $scale) }
  })
}

function Crop-Screen([int]$x, [int]$y, [int]$w, [int]$h) {
  $shot = New-Object System.Drawing.Bitmap $w, $h, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($shot)
  $g.CopyFromScreen($x, $y, 0, 0, (New-Object System.Drawing.Size $w, $h))
  $g.Dispose()
  $shot
}

$proc = [System.Diagnostics.Process]::GetCurrentProcess()
[Console]::Out.WriteLine((@{ ready = $true; ocr = [bool]$engine } | ConvertTo-Json -Compress))
while ($null -ne ($line = [Console]::In.ReadLine())) {
  $parts = $line.Trim() -split '\s+', 6
  if ($parts[0] -eq 'quit') { break }
  # show -3 <path>: writes the last captured corner as the -3 clean-up sees it (for tests).
  if ($parts[0] -eq 'show') {
    if (-not $script:lastCrop) { [Console]::Out.WriteLine('{"saved":false}'); continue }
    $img = [Prep]::Keyed($script:lastCrop)
    $img.Save(($line.Trim() -replace '^show\s+\S+\s+', ''), [System.Drawing.Imaging.ImageFormat]::Png); $img.Dispose()
    [Console]::Out.WriteLine('{"saved":true}')
    continue
  }
  # save <path>: writes the last captured corner as PNG (diagnosis mode only).
  if ($parts[0] -eq 'save') {
    if ($script:lastCrop) { $script:lastCrop.Save(($line.Trim() -replace '^save\s+', ''), [System.Drawing.Imaging.ImageFormat]::Png); [Console]::Out.WriteLine('{"saved":true}') }
    else { [Console]::Out.WriteLine('{"saved":false}') }
    continue
  }
  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  $cpu0 = $proc.TotalProcessorTime.TotalMilliseconds
  if ($parts[0] -eq 'again') {
    try {
      if (-not $script:lastCrop) { [Console]::Out.WriteLine('{"error":"nothing captured yet"}'); continue }
      $lines = Ocr-Bitmap $script:lastCrop ([double]$parts[1]) ([int]$parts[2])
      $proc.Refresh()
      [Console]::Out.WriteLine((@{ lines = $lines; ms = $sw.ElapsedMilliseconds; cpuMs = [int]($proc.TotalProcessorTime.TotalMilliseconds - $cpu0) } | ConvertTo-Json -Compress -Depth 4))
    } catch {
      [Console]::Out.WriteLine((@{ error = $_.Exception.Message } | ConvertTo-Json -Compress))
    }
    continue
  }
  try {
    $rw, $rh, $scale, $threshold = [int]$parts[1], [int]$parts[2], [double]$parts[3], [int]$parts[4]
    $info = @{}
    if ($parts[0] -eq 'file') {
      $src = [System.Drawing.Bitmap]::FromFile($parts[5])
      $w = [Math]::Min($rw, $src.Width); $h = [Math]::Min($rh, $src.Height)
      $bmp = $src.Clone((New-Object System.Drawing.Rectangle ($src.Width - $w), 0, $w, $h), [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
      $src.Dispose()
      $info.window = "$($src.Width) x $($src.Height)"
    } elseif ($parts[0] -eq 'bench') {
      $s = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
      $w = [Math]::Min($rw, $s.Width); $h = [Math]::Min($rh, $s.Height)
      $bmp = Crop-Screen ($s.Right - $w) $s.Top $w $h
      $info.window = "$($s.Width) x $($s.Height)"
    } else {
      $win = Find-Game
      if (-not $win) { [Console]::Out.WriteLine('{"game":false}'); continue }
      if ($win.minimized -or $win.width -le 0) { [Console]::Out.WriteLine('{"game":true,"minimized":true}'); continue }
      $w = [Math]::Min($rw, $win.width); $h = [Math]::Min($rh, $win.height)
      $bmp = Crop-Screen ($win.left + $win.width - $w) $win.top $w $h
      $info.game = $true; $info.foreground = $win.foreground; $info.window = "$($win.width) x $($win.height)"
    }
    $lines = Ocr-Bitmap $bmp $scale $threshold
    if ($script:lastCrop) { $script:lastCrop.Dispose() }
    $script:lastCrop = $bmp
    $proc.Refresh()
    $info.lines = $lines
    $info.ms = $sw.ElapsedMilliseconds
    $info.cpuMs = [int]($proc.TotalProcessorTime.TotalMilliseconds - $cpu0)
    $info.memMB = [int]($proc.WorkingSet64 / 1MB)
    [Console]::Out.WriteLine(($info | ConvertTo-Json -Compress -Depth 4))
  } catch {
    [Console]::Out.WriteLine((@{ error = $_.Exception.Message } | ConvertTo-Json -Compress))
  }
}
