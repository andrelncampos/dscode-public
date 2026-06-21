## ⚡ V40: Performance-First Execution — 4 specs, शून्य रिग्रेशन

I/O, CPU और मेमोरी का सटीक अनुकूलन 4 मोर्चों पर। परिणाम: तेज़ सेशन, हल्का स्टार्टअप, कम इतिहास।

### Session I/O (spec 420)
- **वृद्धिशील लेखन**: संपूर्ण संदेश फ़ाइल को फिर से लिखने के बजाय `appendFileSync`
- **सेशन इंडेक्स कैश**: `_cachedSessionsIndex` मेमोरी में — `loadSessionsIndex()` हर टर्न में 6× बार डिस्क से पढ़ता था
- **डायरेक्टरी गार्ड**: `_projectDirEnsured` अनावश्यक `mkdirSync` से बचाता है
- **स्ट्रिंग बफ़र**: स्ट्रीमिंग लूप में `+=` के बजाय `push` + `join` (हर चंक पर रीअलोकेशन नहीं)

### Startup (spec 430)
- **समानांतर skills**: `Promise.all` + `fs/promises` — एक साथ लोडिंग, शून्य अनुक्रमिक `readFileSync`
- **कैश्ड टेम्पलेट**: Prompt टेम्पलेट (`templates/tools/*.md`, `templates/skills/*.md`) अपरिवर्तनीय कैश में — हर टर्न पर डिस्क से दोबारा नहीं पढ़े जाते

### Compaction और मेमोरी (spec 440)
- **वृद्धिशील हैश**: `findStablePrefixEndIndex()` एकल वृद्धिशील SHA-256 इंस्टेंस का उपयोग करता है — O(N²) के बजाय O(N)
- **समानांतर turns**: `readRecentTurns()` फ़ाइलों को `Promise.all` के साथ समानांतर में डीकंप्रेस करता है
- **एसिंक्रोनस बैकअप**: `backupSpecFile()` `fs/promises.copyFile` का उपयोग करता है — शून्य ब्लॉकिंग

### Hardening (spec 450)
- **सीमित समवर्तीता**: `readRecentTurns` 8 के बैच में प्रोसेस करता है, जल्दी समाप्ति के साथ — कोई I/O बर्बाद नहीं
- **Mtime इनवैलिडेशन**: सेशन इंडेक्स कैश `mtimeMs` की जाँच करता है — मल्टी-टर्मिनल उपयोग के लिए सुरक्षित
- **ENOENT रिकवरी**: यदि `.dscode/` सेशन के दौरान हटा दिया जाए, तो `ensureProjectDir` फ़्लैग रीसेट करता है
- **ESLint `no-floating-promises`**: सक्रिय नियम — 5 उल्लंघन `void` से ठीक किए गए

---

## 🐛 PDF: Context Budget Fix (spec 460)

- **संपीड़ित ObjStm वाले PDF**: जब regex अनुमान विफल होता है, तो `countPdfPages` `null` लौटाता है (`0` नहीं)। बड़े PDF अब context में base64 के रूप में एम्बेड नहीं किए जाते — 1M token विंडो के ओवरफ़्लो को रोकता है।

---

## 🚀 Node.js 24 नेटिव API अनुकूलन

- **Grep handler**: नेटिव `fs.globSync`, एसिंक्रोनस समानांतर रीड, स्ट्रीमिंग — **-143 लाइनें, -1 डिपेंडेंसी**
- **Glob handler**: कस्टम वॉकर को `fs.globSync` से बदला — **-51 लाइनें**

---

## 🔧 सुधार

- **Zod schema में `cacheMode`**: `cacheMode` वाली settings अब अमान्य के रूप में अस्वीकार नहीं की जातीं
- **`/spec-pipe`**: कोई सक्रिय सेशन न होने पर ऑटो-क्रिएट करता है
- **FD लीक**: grep बाइनरी डिटेक्शन catch ब्लॉक और MCP client disconnect में फ़ाइल डिस्क्रिप्टर बंद किए गए
- **अप्रयुक्त वेरिएबल**: grep handler से `unusedInBinaryDetection` regex हटाया गया

---

## 📋 दस्तावेज़ीकरण और इन्फ़्रा

- **5 steering नियम** `AGENTS.md` में: प्राधिकरण, क्रॉस-चेक, सत्यापन, परिणाम, आउटपुट
- **V39 और V40** `vision.md` में दस्तावेज़ित
- **Node 26 सूचना** वेलकम स्क्रीन पर: "अक्टूबर 2026 से, DsCode को Node.js 26 की आवश्यकता होगी।"
- **Release notes** अब `RELEASE_NOTES.md` का उपयोग करते हैं (`--generate-notes` नहीं)

---

## 🚀 Node.js 24 — All-in

Node 24 पर पूर्ण प्रवासन बेसलाइन के रूप में। पुराने संस्करणों के साथ शून्य संगतता।

### डिपेंडेंसी को बदलने वाली नेटिव API
- **`fs.globSync`** नेटिव, npm `glob` पैकेज को बदलता है — **-4 डिपेंडेंसी**
- **`node:zstd`** नेटिव, `node:zlib` के Brotli फ़ॉलबैक को बदलता है — कंप्रेसर 4× छोटा
- **`Error.isError()`** → `getErrorMessage()` फ़ंक्शन, क्रॉस-रील्म सुरक्षित, 21 फ़ाइलों में
- **`structuredClone`** नेटिव — डीप क्लोन 8 लाइनों से 1 में
- **esbuild target `node24`** — Node 22 के लिए कोई polyfills नहीं
- **CI Node 24 पर** — वास्तविक runtime पर build और test

---

## 🍎 macOS Apple Silicon स्वचालित releases में

- macOS ARM64 (`macos-latest`) अब हर tag push पर स्वचालित रूप से build होता है
- macOS Intel (`macos-13`) हटाया गया — GitHub द्वारा डेप्रिकेटेड runner, कोई कतार प्रतीक्षा नहीं
- Dry-run Windows, Linux और macOS ARM64 को कवर करता है
- चेकसम डाउनलोड ठीक किया गया (v1.0.41 में `400 Bad Content-Length` त्रुटि का मूल कारण)

---

## 🔄 मज़बूत ऑटो-अपडेट

- CI और `update-check.ts` के बीच 100% संरेखित एसेट नेमिंग
- Portable पैकेज (SEA विफल होने पर फ़ॉलबैक) अब **सभी** साथी फ़ाइलें कॉपी करते हैं: `dscode.mjs`, `node`, `templates/`, `node_modules/`
- सभी प्लेटफ़ॉर्म पर फ़ाइल निष्कर्षण और परमाणु बाइनरी प्रतिस्थापन

---

## 🖼️ Tesseract.js के साथ स्थानीय OCR

- `tesseract.js` के माध्यम से ऑफ़लाइन OCR, बिना इमेज सपोर्ट वाले मॉडल के लिए (जैसे DeepSeek V4)
- **डायनेमिक import** — `tesseract.js` केवल तब लोड होता है जब OCR वास्तव में उपयोग हो, स्टार्टअप पर शून्य प्रभाव
- सभी 12 ट्रांज़िटिव डिपेंडेंसी portable पैकेज में बंडल
- निकाला गया टेक्स्ट 2000 कैरेक्टर पर ट्रंकेट (शब्द सीमा)
- `/image-paste` और `/image-upload` स्वचालित OCR फ़ॉलबैक के साथ
- टर्मिनल पेस्ट के माध्यम से फ़ाइल ड्रैग-एंड-ड्रॉप

---

## 🐛 सुधार

- **v1.0.41**: प्रकाशन पर `400 Bad Content-Length` त्रुटि — चेकसम डाउनलोड नहीं हो रहे थे
- **v1.0.42/43**: macOS Intel, runner की कमी के कारण releases अटक जाती थीं — pipeline से हटाया
- **Auto-update**: Portable पैकेज अपडेट पर टूट जाते थे — अब साथी फ़ाइलें कॉपी करता है
- **Bundle**: विफलता पर साइलेंट build — अब `exit(1)` और CI इसका पता लगाता है
- **OCR startup**: स्टार्टअप पर `regenerator-runtime` नहीं मिला — `tesseract.js` डिमांड पर लोड
- **Ink ErrorBanner त्रुटि**, context window ओवरफ़्लो, spec suffixes

---

## 📐 स्पेसिफिकेशन और build

- Specs 370-410: build validation, operational resilience, traceability, auto-update
- `validate-binary.mjs` tag वर्शन का उपयोग करता है (package.json नहीं)
- `release-dry-run.yml` 3 प्लेटफ़ॉर्म को कवर करता है
- CI में README URL सत्यापन
