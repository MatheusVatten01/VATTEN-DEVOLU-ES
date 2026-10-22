# Servidor local de desenvolvimento do Vatten Devolucoes.
# Usa apenas o PowerShell do Windows (nao precisa de Python nem Node).
#
# Uso:  powershell -ExecutionPolicy Bypass -File ferramentas\servidor.ps1 [-Porta 8001]
#   Sistema (codigo-fonte): http://localhost:8001/src/
#   Testes automaticos:     http://localhost:8001/testes/
#   HTML unico gerado:      http://localhost:8001/dist/
#
# Porta 8001 para poder rodar junto com o servidor do Vatten PLR (porta 8000).
# Importante: os dados salvos pelo navegador dependem do endereco. O que for
# cadastrado em http://localhost:8001 NAO aparece no HTML aberto por duplo clique
# (file://) e vice-versa. Use este servidor apenas para desenvolver e testar.
param([int]$Porta = 8001)

$raiz = Split-Path -Parent $PSScriptRoot
$tipos = @{
  '.html' = 'text/html; charset=utf-8'; '.js' = 'text/javascript; charset=utf-8'
  '.css'  = 'text/css; charset=utf-8';  '.json' = 'application/json; charset=utf-8'
  '.txt'  = 'text/plain; charset=utf-8'; '.md' = 'text/plain; charset=utf-8'
  '.csv'  = 'text/csv; charset=utf-8'
  '.svg'  = 'image/svg+xml'; '.png' = 'image/png'; '.ico' = 'image/x-icon'
}

function Responder($res, [int]$status, [string]$texto) {
  $res.StatusCode = $status
  $res.ContentType = 'text/plain; charset=utf-8'
  $b = [Text.Encoding]::UTF8.GetBytes($texto)
  $res.OutputStream.Write($b, 0, $b.Length)
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Porta/")
try { $listener.Start() } catch {
  Write-Host "Nao foi possivel abrir a porta $Porta (ja esta em uso?): $($_.Exception.Message)"
  exit 1
}
Write-Host "Servindo $raiz"
Write-Host "Sistema: http://localhost:$Porta/src/"
Write-Host "Testes:  http://localhost:$Porta/testes/"
Write-Host "Pressione Ctrl+C para encerrar."

try {
  while ($listener.IsListening) {
    $ctx = $listener.GetContext()
    $req = $ctx.Request
    $res = $ctx.Response
    try {
      $rel = [Uri]::UnescapeDataString($req.Url.AbsolutePath).TrimStart('/')
      if ($rel -eq '') { $res.Redirect('/src/'); continue }
      $caminho = [IO.Path]::GetFullPath((Join-Path $raiz $rel))
      # Bloqueia acesso fora da pasta do projeto (ex.: /../../Windows).
      if (-not $caminho.StartsWith($raiz, [StringComparison]::OrdinalIgnoreCase)) { Responder $res 403 'Proibido'; continue }

      if ($req.HttpMethod -eq 'PUT') {
        # Usado somente por ferramentas/formatar.html para gravar codigo formatado.
        # Aceita apenas arquivos .js/.css dentro de src/ e vindos desta mesma origem.
        $src = [IO.Path]::GetFullPath((Join-Path $raiz 'src')) + '\'
        $ext = [IO.Path]::GetExtension($caminho).ToLower()
        if ($req.Headers['X-Ferramenta'] -ne 'formatar' -or -not $caminho.StartsWith($src, [StringComparison]::OrdinalIgnoreCase) -or ($ext -ne '.js' -and $ext -ne '.css') -or -not (Test-Path -LiteralPath $caminho -PathType Leaf)) {
          Responder $res 403 'Gravacao nao permitida'; continue
        }
        $leitor = New-Object IO.StreamReader($req.InputStream, [Text.Encoding]::UTF8)
        $texto = $leitor.ReadToEnd(); $leitor.Close()
        [IO.File]::WriteAllText($caminho, $texto, (New-Object Text.UTF8Encoding $false))
        Write-Host ("{0} GRAVADO {1}" -f (Get-Date -Format 'HH:mm:ss'), $rel)
        Responder $res 200 'ok'; continue
      }

      if (Test-Path -LiteralPath $caminho -PathType Container) {
        if (-not $rel.EndsWith('/')) { $res.Redirect('/' + $rel + '/'); continue }
        $indice = Join-Path $caminho 'index.html'
        if (-not (Test-Path -LiteralPath $indice)) {
          $html = Get-ChildItem -LiteralPath $caminho -Filter *.html | Select-Object -First 1
          if ($html) { $indice = $html.FullName }
        }
        $caminho = $indice
      }
      if (-not (Test-Path -LiteralPath $caminho -PathType Leaf)) { Responder $res 404 "404 - nao encontrado: /$rel"; continue }
      $ext = [IO.Path]::GetExtension($caminho).ToLower()
      $res.ContentType = if ($tipos.ContainsKey($ext)) { $tipos[$ext] } else { 'application/octet-stream' }
      $res.Headers.Add('Cache-Control', 'no-store')
      $bytes = [IO.File]::ReadAllBytes($caminho)
      $res.ContentLength64 = $bytes.Length
      $res.OutputStream.Write($bytes, 0, $bytes.Length)
    } catch {
      Write-Host "Erro: $($_.Exception.Message)"
      try { $res.StatusCode = 500 } catch {}
    } finally {
      Write-Host ("{0} {1} {2} {3}" -f (Get-Date -Format 'HH:mm:ss'), $req.HttpMethod, $res.StatusCode, $req.Url.AbsolutePath)
      try { $res.Close() } catch {}
    }
  }
} finally {
  $listener.Stop()
}
