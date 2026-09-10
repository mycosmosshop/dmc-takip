/* DMC takip — mantık kontrolü:  node test.js
 *
 * İki katman sınanır:
 *   A) kaydet()  — kod görülür görülmez karar (ağ arkada), sunucu düzeltmesi,
 *                  yazma hatasında havuzdan geri alma
 *   B) tara()    — kamera kilidi: aynı etiket tek kez, yeni etiket beklemesiz
 *
 * Kaynak dosyadan okunur; yardımcı değil ÜRETİLEN kod ölçülür.
 */
const fs = require('fs');
const KAYNAK = fs.readFileSync(__dirname + '/index.html', 'utf8');
const JS = KAYNAK.slice(KAYNAK.indexOf('<script>') + 8, KAYNAK.lastIndexOf('</script>'));

let hata = 0;
const ol = (ad, k, ek) => {
    if (k) console.log('  ✓ ' + ad + (ek ? '  ' + ek : ''));
    else { console.log('  ✗ ' + ad + (ek ? ' — ' + ek : '')); hata++; }
};
const bekle = (ms) => new Promise((r) => setTimeout(r, ms));

/* ══ A) kaydet(): sahte tarayıcı ortamı ══ */
function ortam(sunucuYanit) {
    const gecen = [], yazilan = [], ekran = { dur: '', kod: '', ek: '' };
    const el = () => ({ value: '', textContent: '', className: '', checked: false,
        classList: { toggle() {}, add() {}, remove() {}, contains: () => false },
        querySelector: () => el(), style: {}, dataset: {},
        addEventListener() {}, scrollIntoView() {} });
    const g = {
        fetch: async (url, o) => {
            gecen.push({ url, yontem: (o && o.method) || 'GET' });
            if (o && o.method === 'POST') yazilan.push(JSON.parse(o.body).kod);
            return sunucuYanit(url, o);
        },
        document: {
            querySelector: (s) => (s === '#sonuc'
                ? { className: '', querySelector: (x) => ({
                    set textContent(v) {
                        ekran[x === '.dur' ? 'dur' : x === '.kod' ? 'kod' : 'ek'] = v;
                    }, get textContent() { return ''; } }) }
                : el()),
            createElement: el, body: { appendChild() {} },
            addEventListener() {}, getElementById: el
        },
        localStorage: { getItem: () => null, setItem() {} },
        navigator: {},
        setTimeout: (f, ms) => (ms > 5000 ? 0 : setTimeout(f, 0)),   // anons kuyruğu
        setInterval: () => 0, clearTimeout() {},
        console, JSON, Date, Math, Set, Map, Array, Object, String, Number, Boolean,
        encodeURIComponent, parseInt, parseFloat, isNaN, Promise, Error,
        URL: { createObjectURL: () => '' }, Blob: function () {}, File: function () {},
        AudioContext: function () {
            return { state: 'running', resume() {}, currentTime: 0, destination: {},
                createOscillator: () => ({ connect() {}, start() {}, stop() {},
                    frequency: {}, type: '' }),
                createGain: () => ({ connect() {}, gain: {
                    setValueAtTime() {}, exponentialRampToValueAtTime() {} } }) };
        },
        speechSynthesis: { cancel() {}, speak() {} },
        SpeechSynthesisUtterance: function (m) { this.text = m; }
    };
    g.window = g;
    const api = new Function('__k', 'with(__k){' + JS + '\nreturn {kaydet, bilinen};}')(
        new Proxy(g, { has: () => true, get: (o, p) => (p in o ? o[p] : undefined) }));
    return { api, gecen, yazilan, ekran };
}

const YAZDI = async () => ({ ok: true, status: 201, json: async () => [{}], text: async () => '' });

/* ══ B) tara(): kamera döngüsünün kilit mantığı ══ */
const bas = JS.indexOf('async function tara()');
// setTimeout ile kendini çağıran kuyruk kesilir; döngü testte elle döndürülür
const govde = JS.slice(bas, JS.indexOf('if (akis) setTimeout(tara', bas)) + '}';

function kamera(kareler) {
    const islenen = [], notlar = [];
    let i = 0;
    const g = {
        akis: {},
        tarayici: { detect: async () => {
            const k = kareler[i++];
            return k ? [{ rawValue: k }] : [];
        } },
        sonKod: '', ayniUyari: 0,
        kaydet: (k) => islenen.push(k),
        $: () => ({ set textContent(v) { notlar.push(v); }, get textContent() { return ''; } }),
        setTimeout: () => 0, console, String, Math, Date, Promise, Object, Array
    };
    const fn = new Function('__k', 'with(__k){' + govde + '\nreturn tara;}')(
        new Proxy(g, { has: () => true, get: (o, p) => (p in o ? o[p] : undefined),
            set: (o, p, v) => { o[p] = v; return true; } }));
    return { calistir: async () => { for (let k = 0; k < kareler.length; k++) await fn(); },
             islenen, notlar };
}

(async function () {
    console.log('A) kaydet — karar hızı ve doğrulama');

    /* Yerelde yok → anında "yeni", ağ arkada */
    {
        const { api, gecen, ekran } = ortam(YAZDI);
        const once = gecen.length;              // başlangıç havuz yüklemesi
        const t0 = Date.now();
        api.kaydet('ABC123');                   // await YOK: senkron dönmeli
        ol('karar anında verildi (ağ beklenmedi)', Date.now() - t0 < 20,
            Date.now() - t0 + ' ms');
        ol('ekranda YENİ KOD', /YENİ KOD/.test(ekran.dur), ekran.dur);
        ol('bekleme metni yok', !/Kontrol|bekleni/i.test(ekran.dur));
        ol('kod yerel havuza eklendi', api.bilinen.has('ABC123'));
        // Yazma hemen başlar (kayıt kaybolmasın) ama SONUCU beklenmez:
        // doğrulama sorgusu ancak POST dönünce gider, ekran ondan önce dolar.
        ol('yalnız yazma isteği başladı, sonucu beklenmedi',
            gecen.length - once === 1, (gecen.length - once) + ' istek');
    }

    /* Yerelde var → anında mükerrer */
    {
        const { api, ekran } = ortam(YAZDI);
        api.bilinen.add('TEKRAR1');
        const t0 = Date.now();
        api.kaydet('TEKRAR1');
        ol('mükerrer anında bildirildi',
            /MÜKERRER/.test(ekran.dur) && Date.now() - t0 < 20, ekran.dur);
    }

    /* Yerel havuz eskiyse sunucu düzeltmeli — sessizce yanlış kalmamalı */
    {
        const { api, ekran } = ortam(async (url, o) => {
            if (o && o.method === 'POST') return { ok: true, status: 201, json: async () => [{}] };
            return { ok: true, status: 200, json: async () => [
                { lokasyon: 'Almanya', okuyan: 'Ali', zaman: '2026-09-10T08:00:00Z' },
                { lokasyon: 'Çerkezköy', okuyan: 'Veli', zaman: '2026-09-10T09:00:00Z' }] };
        });
        api.kaydet('CAPRAZ1');
        ol('önce YENİ gösterildi', /YENİ KOD/.test(ekran.dur), ekran.dur);
        await bekle(30);
        ol('sunucu düzeltmesi geldi → MÜKERRER', /MÜKERRER/.test(ekran.dur), ekran.dur);
        ol('ilk okuma bilgisi yazıldı', /Almanya/.test(ekran.ek), ekran.ek);
    }

    /* Yazma başarısız: sessizce yutulmamalı, havuzdan da çıkmalı */
    {
        const { api, ekran } = ortam(async (url, o) => (o && o.method === 'POST'
            ? { ok: false, status: 500, text: async () => 'sunucu hatasi' }
            : { ok: true, status: 200, json: async () => [] }));
        api.kaydet('YAZILAMAZ');
        await bekle(30);
        ol('yazılamadı uyarısı çıktı', /KAYDEDİLEMEDİ/.test(ekran.dur), ekran.dur);
        ol('havuzdan geri alındı (yanlış "bilinen" kalmasın)',
            !api.bilinen.has('YAZILAMAZ'));
    }

    /* Peş peşe aynı kod: SAHTE mükerrer üretmemeli */
    {
        const { api, ekran, yazilan } = ortam(YAZDI);
        api.kaydet('AYNI1');
        api.kaydet('AYNI1');
        api.kaydet('AYNI1');
        ol('peş peşe tekrar sahte mükerrer üretmiyor',
            !/MÜKERRER/.test(ekran.dur), ekran.dur);
        await bekle(40);
        ol('havuza tek kayıt yazıldı', yazilan.length === 1,
            yazilan.length + ' kayıt');
    }

    /* 1.2 sn sonra elle tekrar okutma: GERÇEK mükerrer sayılmalı */
    {
        const { api, ekran, yazilan } = ortam(YAZDI);
        api.kaydet('GERCEK1');
        await bekle(1300);
        api.kaydet('GERCEK1');
        ol('1.2 sn sonra tekrar okutunca MÜKERRER',
            /MÜKERRER/.test(ekran.dur), ekran.dur);
        await bekle(40);
        ol('ikinci kayıt da yazıldı (iz bırakır)', yazilan.length === 2,
            yazilan.length + ' kayıt');
    }

    console.log('\nB) tara — kamera kilidi');

    /* Aynı etiket kamerada dururken TEK kez işlenmeli */
    {
        const k = kamera(Array(30).fill('ETIKET-A'));
        await k.calistir();
        ol('aynı etiket 30 karede tek kez işlendi', k.islenen.length === 1,
            k.islenen.length + ' işlem');
    }

    /* Çekilip tekrar gösterilse de aynı etiket sayılmamalı */
    {
        const k = kamera(['A', 'A', null, null, null, null, null, null, 'A', 'A', 'A']);
        await k.calistir();
        ol('çekilip tekrar gösterilen aynı etiket işlenmiyor',
            k.islenen.length === 1, k.islenen.length + ' işlem');
    }

    /* Yeni etiket ANINDA işlenmeli — bekleme yok */
    {
        const k = kamera(['A', 'A', 'A', 'B']);
        await k.calistir();
        ol('yeni etiket anında işlendi (bekleme yok)',
            k.islenen.join(',') === 'A,B', k.islenen.join(' → '));
    }

    /* Araya başka etiket girerse A yeniden geçerli */
    {
        const k = kamera(['A', 'B', 'A']);
        await k.calistir();
        ol('araya başka etiket girince A yeniden okunur',
            k.islenen.join(',') === 'A,B,A', k.islenen.join(','));
    }

    /* Peş peşe farklı etiketler: hiçbiri atlanmamalı */
    {
        const k = kamera(['K1', 'K2', 'K3', 'K4', 'K5']);
        await k.calistir();
        ol('peş peşe 5 farklı etiketin hepsi işlendi',
            k.islenen.length === 5, k.islenen.join(','));
    }

    /* Operatör "okumadı mı?" diye beklemesin */
    {
        const k = kamera(Array(20).fill('UZUN-A'));
        await k.calistir();
        ol('“sıradaki etiketi gösterin” uyarısı çıkıyor',
            k.notlar.some((x) => /sıradaki etiketi/.test(x)),
            k.notlar[k.notlar.length - 1]);
    }

    console.log('\n' + (hata ? hata + ' test BAŞARISIZ' : 'tüm testler geçti'));
    process.exit(hata ? 1 : 0);
})();
