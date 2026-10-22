# Gera o HTML unico (autocontido) do Vatten Devolucoes a partir de src/.
#
# Uso:  powershell -ExecutionPolicy Bypass -File ferramentas\build.ps1
# Saida: dist\Vatten_Devolucoes.html  (abrir com duplo clique)
#
# O que faz: copia src\index.html e substitui cada <link href="css/..."> e
# <script src="js/..."> local pelo conteudo do arquivo. O resultado nao pode ter
# nenhum script externo: funciona offline. Nao altera nenhum arquivo de src\.
$ErrorActionPreference = 'Stop'
$raiz = Split-Path -Parent $PSScriptRoot
$src = Join-Path $raiz 'src'
$dist = Join-Path $raiz 'dist'
$saida = Join-Path $dist 'Vatten_Devolucoes.html'
$utf8 = New-Object Text.UTF8Encoding $false

function Ler([string]$rel) {
  $p = Join-Path $src $rel
  if (-not (Test-Path -LiteralPath $p)) { throw "Arquivo referenciado em index.html nao existe: src\$rel" }
  return [IO.File]::ReadAllText($p, [Text.Encoding]::UTF8).TrimEnd()
}

$html = [IO.File]::ReadAllText((Join-Path $src 'index.html'), [Text.Encoding]::UTF8)
$contagem = @{ css = 0; js = 0 }

$html = [regex]::Replace($html, '<link rel="stylesheet" href="(css/[^"]+)">', {
  param($m)
  $contagem.css++
  "<style>`n" + (Ler $m.Groups[1].Value) + "`n</style>"
})

$html = [regex]::Replace($html, '<script([^>]*?)\s+src="(js/[^"]+)"([^>]*)></script>', {
  param($m)
  $conteudo = Ler $m.Groups[2].Value
  # Um "</script" dentro do JS fecharia a tag antes da hora no HTML unico.
  if ($conteudo -match '</script') { throw "O arquivo src\$($m.Groups[2].Value) contem '</script'. Escreva como '<\/script'." }
  # "<!--" dentro de <script> muda o modo do parser HTML e pode engolir o resto da pagina.
  if ($conteudo.Contains('<!--')) { throw "O arquivo src\$($m.Groups[2].Value) contem '<!--'." }
  $contagem.js++
  "<script$($m.Groups[1].Value)$($m.Groups[3].Value)>`n" + $conteudo + "`n</script>"
})

if ($html -match '(href|src)="(css|js)/') { throw 'Sobrou referencia local nao embutida no HTML final.' }
if ($html -match '<script[^>]*\ssrc="https?:') { throw 'Sobrou <script src="http..."> externo: o HTML final deve funcionar sem internet.' }

New-Item -ItemType Directory -Force $dist | Out-Null
[IO.File]::WriteAllText($saida, $html, $utf8)
$hash = (Get-FileHash -LiteralPath $saida -Algorithm SHA256).Hash.Substring(0, 16).ToLower()
Write-Host ("OK: {0} CSS e {1} JS embutidos." -f $contagem.css, $contagem.js)
Write-Host ("Gerado: dist\Vatten_Devolucoes.html ({0:N0} KB, sha256 {1}...)" -f ((Get-Item $saida).Length / 1KB), $hash)
