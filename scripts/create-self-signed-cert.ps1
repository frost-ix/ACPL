# Self-Signed Code Signing Certificate Generation Script for Windows
# Run this in PowerShell as Administrator to generate a self-signed certificate for local testing.

$certName = "AI CLI Launcher CodeSigning"
$pfxPassword = ConvertTo-SecureString -String "123456" -Force -AsPlainText
$pfxFilePath = ".\cert.pfx"

Write-Host "Creating Self-Signed Code Signing Certificate..." -ForegroundColor Cyan

$cert = New-SelfSignedCertificate `
    -Type CodeSigningCert `
    -Subject "CN=$certName" `
    -CertStoreLocation "Cert:\CurrentUser\My" `
    -KeyAlgorithm RSA `
    -KeyLength 2048 `
    -NotAfter (Get-Date).AddYears(5)

Write-Host "Certificate Created with Thumbprint: $($cert.Thumbprint)" -ForegroundColor Green

# Export to PFX
Export-PfxCertificate -Cert $cert -FilePath $pfxFilePath -Password $pfxPassword | Out-Null

Write-Host "Certificate exported to $pfxFilePath" -ForegroundColor Green
Write-Host "To build signed EXE using electron-builder, run:" -ForegroundColor Yellow
Write-Host '$env:CSC_LINK=".\cert.pfx"' -ForegroundColor White
Write-Host '$env:CSC_KEY_PASSWORD="123456"' -ForegroundColor White
Write-Host 'npm run build:exe' -ForegroundColor White
