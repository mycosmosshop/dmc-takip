/* DMC takip — mantık kontrolü:  node test.js
 *
 * Beş katman sınanır:
 *   A) kaydet()  — kod görülür görülmez karar (ağ arkada), sunucu düzeltmesi,
 *                  yazma hatasında havuzdan geri alma
 *   B) tara()    — kamera kilidi: aynı etiket tek kez, yeni etiket beklemesiz
 *   C) okunamadı — ZXing kararı: DMC yok mu, var ama bozuk mu
 *   D) anons     — mükerrer uyarısı Türkçe sesle okunuyor mu
 *   E) okunamadı kaydı — listeye/Excel'e giriyor, havuza girmiyor
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
function ortam(sunucuYanit, sesler) {
    const gecen = [], yazilan = [], ekran = { dur: '', kod: '', ek: '' };
    const konusulan = [];
    const liste = { html: '' };
    sesler = sesler || [];
    // Ayni secici ayni ogeyi dondurmeli: yoksa uygulamanin atadigi
    // onclick baska bir kopyaya yazilir ve test dugmeye basamaz.
    const kutu = {};
    const el = (s) => (kutu[s] || (kutu[s] = { value: '', textContent: '',
        className: '', checked: false,
        classList: { toggle() {}, add() {}, remove() {}, contains: () => false },
        querySelector: () => el(s + ' *'), style: {}, dataset: {},
        addEventListener() {}, scrollIntoView() {} }));
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
                : s === '#liste'
                ? { set innerHTML(v) { liste.html = v; }, get innerHTML() { return liste.html; } }
                : el(s)),          // seciciyi GECIR: yoksa hepsi tek ogeye duser
            createElement: () => el('#yeni' + Math.random()),
            body: { appendChild() {} },
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
        speechSynthesis: {
            cancel() {}, speak(u) { konusulan.push(u); },
            getVoices: () => sesler, addEventListener() {}
        },
        SpeechSynthesisUtterance: function (m) { this.text = m; }
    };
    g.window = g;
    const api = new Function('__k', 'with(__k){' + JS + '\nreturn {kaydet, bilinen, anons, okunamadiKaydet, havuzYukle, xlsUret, csvUret, OKUNAMADI_KOD, listele};}')(
        new Proxy(g, { has: () => true, get: (o, p) => (p in o ? o[p] : undefined) }));
    return { api, gecen, yazilan, ekran, konusulan, liste, dom: el };
}

const YAZDI = async () => ({ ok: true, status: 201, json: async () => [{}], text: async () => '' });

/* ══ B) tara(): kamera döngüsünün kilit mantığı ══ */
// Sabitler, sayaclar ve icerikVar() da GERCEK kaynaktan gelsin diye dilim
// "let akis"ten basliyor; setTimeout ile kendini cagiran kuyruk kesiliyor.
const bas = JS.indexOf('let akis = null');
const govde = JS.slice(bas, JS.indexOf('if (akis) setTimeout(tara', bas)) + '}';

/* kareler elemanlari — BarcodeDetector'in cozemedigi karelerde ZXing'in
   ne dedigi belirleyici:
     'KOD'      -> BarcodeDetector cozdu
     BOS        -> ZXing NotFound: kadrajda DMC yok (bos tezgah, kagit…)
     BOZUK      -> ZXing Checksum: DMC VAR ama okunamiyor
     {zx:'K9'}  -> BarcodeDetector kacirdi, ZXing cozdu
   Olculen gercek davranis: bos tezgah NotFound, karali/silik/kopuk etiket
   Checksum, temiz/bulanik etiket cozuluyor. */
const BOS = { z: 'yok' }, BOZUK = { z: 'okunamiyor' };

function kamera(kareler) {
    const islenen = [], notlar = [], uyarilar = [], sesler = [], kayitlar = [];
    let i = 0, sonSahne = BOS;

    function NotFound() { this.ad = 'NotFound'; }
    const sahteZx = {
        Z: {
            NotFoundException: NotFound,
            BinaryBitmap: function () {},
            HybridBinarizer: function () {},
            HTMLCanvasElementLuminanceSource: function () {}
        },
        okuyucu: {
            decode: () => {
                const s = sonSahne;
                if (s && s.z === 'okunamiyor') throw new Error('checksum');
                if (s && s.zx) return { getText: () => s.zx };
                throw new NotFound();
            }
        },
        tuval: null
    };
    const tuval = { width: 0, height: 0,
        getContext: () => ({ drawImage() {} }) };

    const g = {
        // Dilim kendi "let akis/tarayici/zx"ini getiriyor ve dis degeri
        // GOLGELIYOR; kamerayi acilmis saymak icin dilimden SONRA atiyoruz.
        __akis: {},
        __zx: sahteZx,
        __tarayici: { detect: async () => {
            const k = kareler[i++];
            sonSahne = (typeof k === 'object' && k) ? k : BOS;
            return (typeof k === 'string' && k) ? [{ rawValue: k }] : [];
        } },
        kaydet: (k) => islenen.push(k),
        goster: (tur, dur, kod, ek) => uyarilar.push({ tur, dur, ek }),
        bipOkunamadi: () => sesler.push('okunamadi'),
        okunamadiKaydet: () => kayitlar.push('okunamadi'),
        document: { createElement: () => tuval },
        $: () => ({ videoWidth: 1280, videoHeight: 960,
            set textContent(v) { notlar.push(v); }, get textContent() { return ''; } }),
        setTimeout: () => 0, console, String, Math, Date, Promise, Object, Array,
        Error, Uint8ClampedArray
    };
    const fn = new Function('__k', 'with(__k){' + govde
        + "\nakis = __akis; tarayici = __tarayici; zx = __zx;\nreturn tara;}")(
        new Proxy(g, { has: () => true, get: (o, p) => (p in o ? o[p] : undefined),
            set: (o, p, v) => { o[p] = v; return true; } }));
    return { calistir: async () => { for (let k = 0; k < kareler.length; k++) await fn(); },
             islenen, notlar, uyarilar, sesler, kayitlar };
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
        const k = kamera(['A', 'A', BOS, BOS, BOS, BOS, 'A', 'A', 'A']);
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
        ol('“parçayı çekin, sıradakini gösterin” uyarısı çıkıyor',
            k.notlar.some((x) => /sıradakini gösterin/.test(x)),
            k.notlar[k.notlar.length - 1]);
    }

    /* GERCEK MUKERRER: ayni koddan IKINCI parca. Etiket kadrajdan
       cikip ayni kod yeniden gelirse AYRI bir parcadir — sayilmali.
       Bu kacarsa uygulamanin butun amaci kacar. */
    {
        const k = kamera(['A'].concat(Array(8).fill(BOS), ['A']));
        await k.calistir();
        ol('parça çekilip aynı kod gelince mükerrer sayılıyor',
            k.islenen.join(',') === 'A,A', k.islenen.join(','));
    }

    /* Ama KISA boşluk kilidi açmamalı — kamera bir kareyi kaçırdı diye
       aynı etiket ikinci kez sayılmasın. */
    {
        const k = kamera(['A', BOS, BOS, 'A']);
        await k.calistir();
        ol('kısa boşluk aynı etiketi ikinci kez saymıyor',
            k.islenen.length === 1, k.islenen.join(','));
    }

    /* Etiket kadrajda ama titrek okunuyorsa (ZXing "okunamiyor" diyor)
       kilit açılmamalı: sahada 5 sahte mükerrer bundan çıkmıştı. */
    {
        const k = kamera(['A'].concat(Array(12).fill(BOZUK), ['A']));
        await k.calistir();
        ol('etiket kadrajdayken titrek okuma sahte mükerrer üretmiyor',
            k.islenen.length === 1, k.islenen.join(','));
    }

    console.log('\nC) okunamayan etiket — kararı ZXing veriyor');

    /* Kadrajda DMC YOK: kamera ne kadar boşluğa bakarsa baksın sessiz.
       Sahadaki üç şikâyet de buydu: "boşlukta okunamadı diyor". */
    {
        const k = kamera(Array(120).fill(BOS));
        await k.calistir();
        ol('kadrajda DMC yokken uyarı çıkmıyor', k.uyarilar.length === 0,
            k.uyarilar.length + ' uyarı / 120 kare');
    }

    /* DMC VAR ama çözülemiyor → uyarı + kayıt */
    {
        const k = kamera(Array(30).fill(BOZUK));
        await k.calistir();
        const u = k.uyarilar[0];
        ol('bozuk etiket uyarı veriyor', k.uyarilar.length === 1 && !!u,
            u ? u.dur : 'uyarı yok');
        ol('uyarıda sebep ipucu var',
            !!u && /silik/i.test(u.ek) && /yamuk/i.test(u.ek), u && u.ek);
        ol('okunamadı sesi çaldı', k.sesler.length === 1);
        ol('okunamadı kaydı yazıldı', k.kayitlar.length === 1);
    }

    /* Uyarı art arda çalmamalı (sessizlik penceresi) */
    {
        const k = kamera(Array(200).fill(BOZUK));
        await k.calistir();
        ol('uyarı art arda tekrarlamıyor', k.uyarilar.length === 1,
            k.uyarilar.length + ' uyarı / 200 kare');
    }

    /* Tek tük bozuk kare uyarı üretmemeli (ardışık olmalı) */
    {
        const k = kamera([BOZUK, BOS, BOZUK, BOS, BOZUK, BOS, BOZUK, BOS,
                          BOZUK, BOS, BOZUK, BOS, BOZUK, BOS]);
        await k.calistir();
        ol('tek tük bozuk kare uyarı üretmiyor', k.uyarilar.length === 0,
            k.uyarilar.length + ' uyarı');
    }

    /* ZXing, BarcodeDetector'ın kaçırdığını çözerse KAYIT olmalı */
    {
        const k = kamera([{ zx: 'ZX-KOD-1' }, { zx: 'ZX-KOD-1' }]);
        await k.calistir();
        ol('ZXing çözünce kod kaydediliyor (kaçan okuma kurtarılıyor)',
            k.islenen.join(',') === 'ZX-KOD-1', k.islenen.join(','));
        ol('ZXing çözümü uyarı üretmiyor', k.uyarilar.length === 0);
    }

    console.log('\nD) sesli anons Türkçe');

    /* Cihazda Türkçe ses varsa o seçilmeli */
    {
        const { api, konusulan } = ortam(YAZDI,
            [{ lang: 'en-US', name: 'English' }, { lang: 'tr-TR', name: 'Türkçe' }]);
        api.anons('Mükerrer kod');
        ol('Türkçe ses seçildi',
            konusulan.length === 1 && konusulan[0].voice
            && /^tr/i.test(konusulan[0].voice.lang),
            konusulan[0] && konusulan[0].voice && konusulan[0].voice.name);
        ol('lang tr-TR', konusulan[0] && konusulan[0].lang === 'tr-TR');
    }

    /* Türkçe ses yoksa İngilizce telaffuzla okumasın */
    {
        const { api, konusulan } = ortam(YAZDI, [{ lang: 'en-US', name: 'English' }]);
        api.anons('Mükerrer kod');
        ol('Türkçe ses yoksa anons yapılmıyor (bip yeterli)',
            konusulan.length === 0, konusulan.length + ' anons');
    }

    console.log('\nE) okunamayan kayıt listeye giriyor');

    /* Sunucuya yazılıyor ama HAVUZA girmiyor */
    {
        const { api, yazilan } = ortam(YAZDI);
        await api.okunamadiKaydet();
        ol('okunamayan kayıt sunucuya yazıldı',
            yazilan.length === 1 && yazilan[0] === '(okunamadı)', yazilan.join(','));
        // Havuza girseydi İKİNCİ okunamayan etiket "mükerrer" görünürdü.
        ol('havuza girmedi (ikincisi mükerrer görünmesin)',
            !api.bilinen.has('(okunamadı)'));
    }

    /* Sunucudaki okunamadı kayıtları havuza ALINMAMALI */
    {
        const { api } = ortam(async () => ({ ok: true, status: 200,
            json: async () => [{ kod: '(okunamadı)' }, { kod: 'GERCEK-1' }],
            text: async () => '' }));
        await api.havuzYukle(true);
        ol('havuz yüklemesi okunamadı kodunu süzüyor',
            !api.bilinen.has('(okunamadı)') && api.bilinen.has('GERCEK-1'));
    }

    /* Listede sarı satır + rozet */
    {
        const { api, liste } = ortam(async () => ({ ok: true, status: 200,
            headers: { get: () => null },
            json: async () => [
                { id: 1, kod: '(okunamadı)', mukerrer: false, lokasyon: 'Ankara',
                  okuyan: '', zaman: '2026-09-10T08:00:00Z' },
                { id: 2, kod: 'K1', mukerrer: true, lokasyon: 'Çerkezköy',
                  okuyan: 'Ali', zaman: '2026-09-10T09:00:00Z' }],
            text: async () => '' }));
        await api.listele();
        ol('listede OKUNAMADI rozeti var', /OKUNAMADI/.test(liste.html));
        ol('okunamadı satırı sarı sınıfta', /class="om"/.test(liste.html));
        ol('mükerrer satırı hâlâ kırmızı sınıfta', /class="mk"/.test(liste.html));
    }

    /* Excel: sarı satır, ayrı etiket, dipnotta sayı */
    {
        const { api } = ortam(YAZDI);
        const x = api.xlsUret([
            { kod: '(okunamadı)', mukerrer: false, lokasyon: 'Ankara',
              okuyan: 'Ali', zaman: '2026-09-10T08:00:00Z' },
            { kod: 'K1', mukerrer: true, lokasyon: 'Çerkezköy',
              okuyan: 'Veli', zaman: '2026-09-10T09:00:00Z' }]);
        ol('Excel okunamadı satırı sarı', /fdf3d8/.test(x));
        ol('Excel durum sütunu OKUNAMADI', /<td>OKUNAMADI<\/td>/.test(x));
        ol('mükerrer hâlâ kırmızı', /fdecea/.test(x));
        ol('dipnotta okunamadı sayısı', /1 okunamadı/.test(x),
            (x.match(/Toplam[^<]*/) || [])[0]);
    }

    /* ── F) iPhone: BarcodeDetector YOK ──
     * Kirilan hal: kod "Bu tarayici kodu cozemiyor" deyip DONUYORDU;
     * getUserMedia hic cagrilmiyor, ekran acilmiyordu. ZXing DataMatrix'i
     * kendi cozdugu icin detektorsuz de calismali. */
    console.log('\nF) iPhone — BarcodeDetector olmadan');
    {
        const acKaynak = JS.slice(JS.indexOf('if (!navigator.mediaDevices'),
                                  JS.indexOf('async function tara()'));
        ol('detektör yokluğunda kameradan ÖNCE return edilmiyor',
            acKaynak.indexOf("'BarcodeDetector' in window") >= 0
            && !/BarcodeDetector' in window\)\)[\s\S]{0,200}?return;/.test(acKaynak));
        ol('BarcodeDetector koşullu kuruluyor, kamera yine açılıyor',
            acKaynak.lastIndexOf('getUserMedia')
            > acKaynak.indexOf("'BarcodeDetector' in window"));
        ol('mediaDevices yoksa https uyarısı veriliyor',
            /https:\/\//.test(acKaynak) && /mediaDevices/.test(acKaynak));
        ol('kamera izni reddinde net mesaj',
            /NotAllowed|Permission/.test(acKaynak));
        ol('tara() detektörsüz çalışıyor',
            /const bulunan = tarayici \? await tarayici\.detect/.test(JS));
    }
    {
        /* Her etiket ZX_ADIM (2) kare kadrajda; arada kadraj bosaliyor */
        const k = kamera(['DMC-IP-1', 'DMC-IP-1', BOS, BOS, BOS, BOS,
                          BOS, BOS, 'DMC-IP-2', 'DMC-IP-2'], true);
        await k.calistir();
        ol('detektörsüz (iPhone) ZXing ile okuyor',
            k.islenen.length === 2, k.islenen.join(',') || '(hiç okumadı)');
        ol('aynı etiket tek kez sayıldı',
            k.islenen[0] === 'DMC-IP-1' && k.islenen[1] === 'DMC-IP-2',
            k.islenen.join(','));
    }
    {
        const bozuk = [];
        for (let z = 0; z < 14; z++) bozuk.push(BOZUK);
        const k = kamera(bozuk, true);
        await k.calistir();
        ol('detektörsüz okunamayan etiket yine uyarıyor ve kaydediliyor',
            k.uyarilar.length >= 1 && k.kayitlar.length >= 1,
            k.uyarilar.length + ' uyarı · ' + k.kayitlar.length + ' kayıt');
    }

    /* ── G) Excel/CSV aktarimi: Turkce karakter ──
     * Kirilan hal: .xls HTML dosyasinda <meta charset="utf-8"> vardi ama
     * Excel bu etiketi cogu zaman YOK SAYIP sistem kod sayfasiyla aciyor;
     * "MUKERRER" ve tedarikci adlari bozuk cikiyordu. BOM sart. */
    console.log('\nG) Excel/CSV — Türkçe karakter');
    {
        const { api } = ortam(YAZDI);
        const K = [
            { kod: 'DMC-TR-1', mukerrer: false, lokasyon: 'ÇERKEZKÖY Üretim',
              okuyan: 'Şükrü Öztürk', zaman: '2026-09-11T08:00:00Z' },
            { kod: 'DMC-TR-1', mukerrer: true, lokasyon: 'ÇERKEZKÖY Üretim',
              okuyan: 'Şükrü Öztürk', zaman: '2026-09-11T08:01:00Z' },
            { kod: api.OKUNAMADI_KOD || '(okunamadı)', mukerrer: false,
              lokasyon: 'İSTANBUL Sevkiyat', okuyan: 'Ayşe Gül',
              zaman: '2026-09-11T08:02:00Z' },
        ];
        const xls = api.xlsUret(K);
        const csv = api.csvUret(K);

        ol('xls UTF-8 BOM ile başlıyor (Excel kod sayfasını kaçırmasın)',
            xls.charCodeAt(0) === 0xFEFF,
            'ilk kod: U+' + xls.charCodeAt(0).toString(16).toUpperCase());
        ol('csv UTF-8 BOM ile başlıyor', csv.charCodeAt(0) === 0xFEFF);
        ol('xls http-equiv charset de yazıyor',
            /http-equiv="Content-Type"[^>]*charset=utf-8/i.test(xls));

        const TR = ['ÇERKEZKÖY', 'Şükrü Öztürk', 'İSTANBUL', 'Ayşe Gül',
                    'MÜKERRER'];
        const eksikX = TR.filter((x) => xls.indexOf(x) < 0);
        const eksikC = TR.filter((x) => csv.indexOf(x) < 0);
        ol('xls Türkçe harfleri koruyor', !eksikX.length, eksikX.join(','));
        ol('csv Türkçe harfleri koruyor', !eksikC.length, eksikC.join(','));

        /* UTF-8'e cevrilince gercekten cok baytli mi (mojibake degil) */
        const bayt = Buffer.from(xls, 'utf8');
        ol('xls UTF-8 olarak kodlanabiliyor',
            bayt.toString('utf8').indexOf('ÇERKEZKÖY') >= 0);
        ol('BOM baytlari EF BB BF',
            bayt[0] === 0xEF && bayt[1] === 0xBB && bayt[2] === 0xBF,
            [bayt[0], bayt[1], bayt[2]].join(' '));

        ol('csv okunamayan etiketi OKUNAMADI diye yazıyor',
            csv.indexOf('OKUNAMADI') >= 0);
        ol('csv ayraç bildirimi ilk satırda (Excel TR tek hücreye basmasın)',
            csv.slice(1).startsWith('sep=;'), csv.slice(1, 12));
    }

    console.log('\n' + (hata ? hata + ' test BAŞARISIZ' : 'tüm testler geçti'));
    process.exit(hata ? 1 : 0);
})();
