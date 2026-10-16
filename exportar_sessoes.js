// =====================================================================
// 📦 EXPORTADOR DE SESSÕES DOS SNIPERS (PARA MIGRAÇÃO AO EASYPANEL)
// Empacota auth_sniper_1 até 4 e a Whitelist em um arquivo .zip
// =====================================================================
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');

console.log('=================================================================');
console.log('📦  EMPACOTADOR DE SESSÕES DOS SNIPERS // AEGIS C2');
console.log('=================================================================\n');

const ARQUIVO_SAIDA = path.join(__dirname, 'aegis_sessoes_snipers.zip');
const zip = new AdmZip();

let pastasEncontradas = 0;

for (let i = 1; i <= 4; i++) {
    const pasta = path.join(__dirname, `auth_sniper_${i}`);
    if (fs.existsSync(pasta)) {
        console.log(`[+] Compactando auth_sniper_${i}...`);
        zip.addLocalFolder(pasta, `auth_sniper_${i}`);
        pastasEncontradas++;
    } else {
        console.log(`[-] auth_sniper_${i} não encontrada (pulando).`);
    }
}

const arquivoWhitelist = path.join(__dirname, 'whitelist_aegis.json');
if (fs.existsSync(arquivoWhitelist)) {
    console.log('[+] Adicionando whitelist_aegis.json ao pacote...');
    zip.addLocalFile(arquivoWhitelist);
}

const arquivoMetadata = path.join(__dirname, 'whitelist_metadata.json');
if (fs.existsSync(arquivoMetadata)) {
    console.log('[+] Adicionando whitelist_metadata.json ao pacote...');
    zip.addLocalFile(arquivoMetadata);
}

if (pastasEncontradas === 0) {
    console.error('\n❌ Nenhuma pasta de sessão auth_sniper_* foi encontrada.');
    process.exit(1);
}

console.log('\n[*] Escrevendo arquivo zip...');
zip.writeZip(ARQUIVO_SAIDA);

console.log('=================================================================');
console.log(`✅ SUCESSO! Pacote gerado com sucesso em:`);
console.log(`📁 ${ARQUIVO_SAIDA}`);
console.log('=================================================================');
console.log('👉 Como usar no Easypanel:');
console.log('1. Suba seu projeto para o Easypanel.');
console.log('2. Abra o Painel Web do Aegis no navegador.');
console.log('3. Use a ferramenta "Restaurar Sessões (Upload ZIP)" ou envie este arquivo.');
console.log('=================================================================\n');
