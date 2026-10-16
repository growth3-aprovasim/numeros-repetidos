// =====================================================================
// 📦 EXPORTADOR DE SESSÕES DOS ESPIÕES / SNIPERS (PARA MIGRAÇÃO AO EASYPANEL)
// Empacota todas as pastas de sessões auth_* e os dados do sistema em um .zip
// =====================================================================
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');

console.log('=================================================================');
console.log('📦  EMPACOTADOR DE SESSÕES & DADOS // AEGIS C2');
console.log('=================================================================\n');

const ARQUIVO_SAIDA = path.join(__dirname, 'aegis_sessoes_snipers.zip');
const zip = new AdmZip();

let pastasEncontradas = 0;

// Escaneia todas as pastas auth_* na raiz do projeto
const itens = fs.readdirSync(__dirname);
for (const item of itens) {
    if ((item.startsWith('auth_sniper_') || item.startsWith('auth_spotter_')) && fs.statSync(path.join(__dirname, item)).isDirectory()) {
        console.log(`[+] Compactando pasta ${item}...`);
        zip.addLocalFolder(path.join(__dirname, item), item);
        pastasEncontradas++;
    }
}

const arquivosParaAdicionar = [
    'whitelist_aegis.json',
    'whitelist_metadata.json',
    'blacklist_aegis.json',
    'config_aegis.json'
];

for (const arq of arquivosParaAdicionar) {
    const p = path.join(__dirname, arq);
    if (fs.existsSync(p)) {
        console.log(`[+] Adicionando ${arq} ao pacote...`);
        zip.addLocalFile(p);
    }
}

if (pastasEncontradas === 0) {
    console.warn('\n⚠️ Nenhuma pasta de sessão auth_* foi encontrada. Compactando apenas arquivos de configuração.');
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
