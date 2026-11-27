if(!self.define){let s,e={};const i=(i,r)=>(i=new URL(i+".js",r).href,e[i]||new Promise(e=>{if("document"in self){const s=document.createElement("script");s.src=i,s.onload=e,document.head.appendChild(s)}else s=i,importScripts(i),e()}).then(()=>{let s=e[i];if(!s)throw new Error(`Module ${i} didn’t register its module`);return s}));self.define=(r,n)=>{const a=s||("document"in self?document.currentScript.src:"")||location.href;if(e[a])return;let l={};const o=s=>i(s,a),t={module:{uri:a},exports:l,require:o};e[a]=Promise.all(r.map(s=>t[s]||o(s))).then(s=>(n(...s),l))}}define(["./workbox-2ff6bd68"],function(s){"use strict";self.addEventListener("message",s=>{s.data&&"SKIP_WAITING"===s.data.type&&self.skipWaiting()}),s.precacheAndRoute([{url:"index.html",revision:"92691335c397672fd137ecc71b8a40b7"},{url:"pdfjs/wasm/openjpeg_nowasm_fallback.js",revision:"84ca6760c86796cea2e10588dfe1c93a"},{url:"pdfjs/wasm/jbig2_nowasm_fallback.js",revision:"802ec05c40f0ae9f581cdc997360bf00"},{url:"fonts/literata-latin-wght-normal.woff2",revision:"3dfc6740cd5399656c1f152420541e88"},{url:"fonts/literata-latin-wght-italic.woff2",revision:"171ab726ef887292ef39ce8dc30750c2"},{url:"assets/zipValidate.worker-17JXVmNk.js",revision:null},{url:"assets/zipValidate-DOG7B50z.js",revision:null},{url:"assets/worker-CtwqDReR.js",revision:null},{url:"assets/workbox-window.prod.umd-BU7Fe4g6.js",revision:null},{url:"assets/whisper.worker-O-ZnmuZ-.js",revision:null},{url:"assets/web-CzLwFBCQ.js",revision:null},{url:"assets/web-CmVPu_df.js",revision:null},{url:"assets/settings-Zdk52XZa.js",revision:null},{url:"assets/rolldown-runtime-BCiCTKAo.js",revision:null},{url:"assets/readability-B9ETiBg-.js",revision:null},{url:"assets/platform-Db9pMNTK.js",revision:null},{url:"assets/pdfWorker-B3adA6Ea.js",revision:null},{url:"assets/PdfView-DtQjvlmo.css",revision:null},{url:"assets/PdfView-BgfDWZZn.js",revision:null},{url:"assets/pdfAssets-Cpy9Da1_.js",revision:null},{url:"assets/pdf-D7REu7L9.js",revision:null},{url:"assets/lib-DTd0FJGs.js",revision:null},{url:"assets/kokoro.worker-ClBZSJt3.js",revision:null},{url:"assets/index-D53vPbv-.css",revision:null},{url:"assets/index-B_YMqnYQ.js",revision:null},{url:"assets/esm-BfUuU2j_.js",revision:null},{url:"assets/epub-BYX3YqGZ.js",revision:null},{url:"assets/docx-B4cKoRht.js",revision:null},{url:"assets/dist-62TeNfsI.js",revision:null},{url:"assets/detector.worker-Cja5_zVh.js",revision:null},{url:"assets/db-95eLHQjN.js",revision:null},{url:"pdfjs/wasm/qcms_bg.wasm",revision:"6cbf49afb11a3f4266a05fa334d38d69"},{url:"pdfjs/wasm/openjpeg.wasm",revision:"42996095ae57bd308c690be001bca626"},{url:"pdfjs/wasm/jbig2.wasm",revision:"c55c187140683a15525797eaabd07656"},{url:"pdfjs/standard_fonts/LiberationSans-Regular.ttf",revision:"dceebf9db79d2acf4a12b8ef7c6fda3e"},{url:"pdfjs/standard_fonts/LiberationSans-Italic.ttf",revision:"d235bec3a6ae3a86fec2a79f2ab42c97"},{url:"pdfjs/standard_fonts/LiberationSans-BoldItalic.ttf",revision:"c190aa8a01fe181754e83d8fe9d6425d"},{url:"pdfjs/standard_fonts/LiberationSans-Bold.ttf",revision:"a720cdc76cacedfaaddc13de2bb7e6b5"},{url:"pdfjs/standard_fonts/FoxitSymbol.pfb",revision:"bf32dea01c56a04d7acede124ce34203"},{url:"pdfjs/standard_fonts/FoxitSerifItalic.pfb",revision:"317e621502668c351d7da56d5f49142c"},{url:"pdfjs/standard_fonts/FoxitSerifBoldItalic.pfb",revision:"727374189158907be1f3da01c224f0f3"},{url:"pdfjs/standard_fonts/FoxitSerifBold.pfb",revision:"1cd12e9c39eb66347c75e32cb1d9660e"},{url:"pdfjs/standard_fonts/FoxitSerif.pfb",revision:"65b3795a07441301ba4baacf5b3c9381"},{url:"pdfjs/standard_fonts/FoxitFixedItalic.pfb",revision:"1fe3439747ae310e7f40810d4f82a451"},{url:"pdfjs/standard_fonts/FoxitFixedBoldItalic.pfb",revision:"02c104df79fe576e33d0ada201e84ebb"},{url:"pdfjs/standard_fonts/FoxitFixedBold.pfb",revision:"4225d6a0b272fc4ce8369911f1184c3c"},{url:"pdfjs/standard_fonts/FoxitFixed.pfb",revision:"7a3a4872294289b49d4b2f396d4ec2f4"},{url:"pdfjs/standard_fonts/FoxitDingbats.pfb",revision:"0ede4a10145bb9a3cfb4cf53fe3e6f22"},{url:"pdfjs/iccs/CGATS001Compat-v2-micro.icc",revision:"56a85233ee08fa7527875be36cf426d6"},{url:"apple-touch-icon.png",revision:"e2753bfc87eaac4e343ccc806ebccc4a"},{url:"icon-192.png",revision:"828c24492cc5b14a8126656d38f87a6a"},{url:"icon-512.png",revision:"5e21bc732ae55795bda95051ec35b7af"},{url:"icon.svg",revision:"01360db748c9243397848f930ba29c9d"},{url:"manifest.webmanifest",revision:"1b47fdaa07e1fff821c2a0fcbabd0c2e"}],{}),s.cleanupOutdatedCaches(),s.registerRoute(new s.NavigationRoute(s.createHandlerBoundToURL("/Read-IT/index.html"))),s.registerRoute(({url:s})=>{const e=new URL(self.registration.scope);return s.origin===e.origin&&s.pathname.startsWith(new URL("ort/",e).pathname)},new s.CacheFirst({cacheName:"readit-ort-runtime-00714593dc",plugins:[new s.ExpirationPlugin({maxEntries:10})]}),"GET"),s.registerRoute(({url:s})=>{const e=new URL(self.registration.scope);return s.origin===e.origin&&s.pathname.startsWith(new URL("lexicon/",e).pathname)},new s.CacheFirst({cacheName:"readit-g2p-lexicon-c667661d3e",plugins:[new s.ExpirationPlugin({maxEntries:3})]}),"GET")});

// Read IT: remove obsolete versioned runtime caches, never reader data.
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    if (!self.caches) return;
    const names = await self.caches.keys();
    const stale = (function selectStaleRuntimeCaches(cacheNames, currentOrtCache, currentLexiconCache) {
	const current = /* @__PURE__ */ new Set([currentOrtCache, currentLexiconCache]);
	return cacheNames.filter((name) => (name.startsWith("readit-ort-runtime-") || name.startsWith("readit-g2p-lexicon-")) && !current.has(name));
})(names, "readit-ort-runtime-00714593dc", "readit-g2p-lexicon-c667661d3e");
    await Promise.all(stale.map((name) => self.caches.delete(name)));

    // Older builds used generic cache names on a potentially shared origin.
    // Remove only this app's exact-scope ORT/lexicon requests; another app's
    // entries and the shared bucket itself must survive.
    const scopeUrl = new URL(self.registration.scope);
    const scope = scopeUrl.pathname.endsWith('/') ? scopeUrl.pathname : scopeUrl.pathname + '/';
    const legacy = (function selectLegacyRuntimeCaches(cacheNames) {
	return cacheNames.filter((name) => name.startsWith("ort-runtime-") || name.startsWith("g2p-lexicon-"));
})(names);
    for (const name of legacy) {
      const cache = await self.caches.open(name);
      const requests = await cache.keys();
      const ours = requests.filter((request) => {
        const url = new URL(request.url);
        return url.origin === scopeUrl.origin &&
          (url.pathname.startsWith(scope + 'ort/') || url.pathname.startsWith(scope + 'lexicon/'));
      });
      await Promise.all(ours.map((request) => cache.delete(request)));
      // Leave the legacy bucket itself in place: another app may write to it
      // between our key checks, and Cache API has no conditional bucket delete.
    }
  })());
});
