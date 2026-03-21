#!/usr/bin/env node
/**
 * Load a URL in headless Chrome, inject the DeeperDive widget below the og:image (or largest image),
 * strip common pop-ups/cookie walls, then save a PNG of the article region only (not the whole site).
 *
 * Usage:
 *   node capture.mjs --url https://www.example.com/article -o ./mock.png
 *   npm run serve   # then open http://127.0.0.1:3847
 */

import { mkdirSync } from "node:fs";
import path, { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer";
import { waitUntilCmpResolvedAndSettled } from "./cmp-resolve.mjs";
import { buildWidgetMarkup } from "./widget.mjs";

const VIEWPORT_PRESETS = {
	desktop: { width: 1280, height: 900, deviceScaleFactor: 2 },
	mobile: { width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
};

const MOBILE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

const WIDGET_I18N = {
	en: { title: "What You Need To Know", readMore: "Read more", interestsLabel: "Based on your interests", ask: (p) => `Ask ${p} anything`, interestQuestion: "What are the latest developments in this story?" },
	fr: { title: "Ce qu'il faut savoir", readMore: "Lire la suite", interestsLabel: "Selon vos centres d'intérêt", ask: (p) => `Posez vos questions à ${p}`, interestQuestion: "Quels sont les derniers développements de cette affaire ?" },
	de: { title: "Das Wichtigste im Überblick", readMore: "Weiterlesen", interestsLabel: "Basierend auf Ihren Interessen", ask: (p) => `Fragen Sie ${p}`, interestQuestion: "Was sind die neuesten Entwicklungen in dieser Geschichte?" },
	es: { title: "Lo que necesitas saber", readMore: "Leer más", interestsLabel: "Según tus intereses", ask: (p) => `Pregunta a ${p} lo que quieras`, interestQuestion: "¿Cuáles son los últimos avances en esta historia?" },
	it: { title: "Quello che devi sapere", readMore: "Leggi di più", interestsLabel: "In base ai tuoi interessi", ask: (p) => `Chiedi a ${p} qualsiasi cosa`, interestQuestion: "Quali sono gli ultimi sviluppi di questa vicenda?" },
	pt: { title: "O que você precisa saber", readMore: "Leia mais", interestsLabel: "Com base nos seus interesses", ask: (p) => `Pergunte ao ${p} qualquer coisa`, interestQuestion: "Quais são os últimos desdobramentos desta história?" },
	nl: { title: "Wat je moet weten", readMore: "Lees meer", interestsLabel: "Op basis van je interesses", ask: (p) => `Stel ${p} een vraag`, interestQuestion: "Wat zijn de laatste ontwikkelingen in dit verhaal?" },
	ar: { title: "ما تحتاج إلى معرفته", readMore: "اقرأ المزيد", interestsLabel: "بناءً على اهتماماتك", ask: (p) => `اسأل ${p} أي شيء`, interestQuestion: "ما هي آخر التطورات في هذه القصة؟" },
	ja: { title: "知っておくべきこと", readMore: "続きを読む", interestsLabel: "あなたの関心に基づいて", ask: (p) => `${p}に何でも聞こう`, interestQuestion: "この記事の最新の展開は？" },
	ko: { title: "알아야 할 사항", readMore: "더 읽기", interestsLabel: "관심사 기반", ask: (p) => `${p}에게 무엇이든 물어보세요`, interestQuestion: "이 기사의 최신 전개 상황은?" },
	zh: { title: "你需要知道的", readMore: "阅读更多", interestsLabel: "根据你的兴趣", ask: (p) => `向${p}提问`, interestQuestion: "这个事件的最新进展是什么？" },
	hi: { title: "आपको क्या जानना चाहिए", readMore: "और पढ़ें", interestsLabel: "आपकी रुचियों के आधार पर", ask: (p) => `${p} से कुछ भी पूछें`, interestQuestion: "इस कहानी में नवीनतम विकास क्या हैं?" },
	bn: { title: "আপনার যা জানা দরকার", readMore: "আরও পড়ুন", interestsLabel: "আপনার আগ্রহের ভিত্তিতে", ask: (p) => `${p}-কে যেকোনো প্রশ্ন করুন`, interestQuestion: "এই ঘটনার সর্বশেষ অগ্রগতি কী?" },
	ru: { title: "Что нужно знать", readMore: "Читать далее", interestsLabel: "На основе ваших интересов", ask: (p) => `Спросите ${p} что угодно`, interestQuestion: "Каковы последние события в этой истории?" },
	tr: { title: "Bilmeniz gerekenler", readMore: "Devamını oku", interestsLabel: "İlgi alanlarınıza göre", ask: (p) => `${p}'a her şeyi sorun`, interestQuestion: "Bu haberdeki son gelişmeler neler?" },
	vi: { title: "Những điều cần biết", readMore: "Đọc thêm", interestsLabel: "Dựa trên sở thích của bạn", ask: (p) => `Hỏi ${p} bất cứ điều gì`, interestQuestion: "Diễn biến mới nhất của câu chuyện này là gì?" },
	th: { title: "สิ่งที่คุณต้องรู้", readMore: "อ่านต่อ", interestsLabel: "ตามความสนใจของคุณ", ask: (p) => `ถาม ${p} ได้ทุกเรื่อง`, interestQuestion: "พัฒนาการล่าสุดของเรื่องนี้คืออะไร?" },
	pl: { title: "Co musisz wiedzieć", readMore: "Czytaj dalej", interestsLabel: "Na podstawie Twoich zainteresowań", ask: (p) => `Zapytaj ${p} o cokolwiek`, interestQuestion: "Jakie są najnowsze wydarzenia w tej sprawie?" },
	uk: { title: "Що потрібно знати", readMore: "Читати далі", interestsLabel: "На основі ваших інтересів", ask: (p) => `Запитайте ${p} будь-що`, interestQuestion: "Які останні події в цій історії?" },
	ro: { title: "Ce trebuie să știi", readMore: "Citește mai mult", interestsLabel: "Pe baza intereselor tale", ask: (p) => `Întreabă ${p} orice`, interestQuestion: "Care sunt cele mai recente evoluții?" },
	cs: { title: "Co potřebujete vědět", readMore: "Číst dále", interestsLabel: "Na základě vašich zájmů", ask: (p) => `Zeptejte se ${p} na cokoliv`, interestQuestion: "Jaký je nejnovější vývoj v tomto příběhu?" },
	sv: { title: "Det du behöver veta", readMore: "Läs mer", interestsLabel: "Baserat på dina intressen", ask: (p) => `Fråga ${p} vad som helst`, interestQuestion: "Vilka är de senaste händelserna i den här historien?" },
	da: { title: "Det du skal vide", readMore: "Læs mere", interestsLabel: "Baseret på dine interesser", ask: (p) => `Spørg ${p} om hvad som helst`, interestQuestion: "Hvad er den seneste udvikling i denne historie?" },
	fi: { title: "Mitä sinun tulee tietää", readMore: "Lue lisää", interestsLabel: "Kiinnostustesi perusteella", ask: (p) => `Kysy ${p}ltä mitä tahansa`, interestQuestion: "Mitkä ovat viimeisimmät tapahtumat tässä tarinassa?" },
	no: { title: "Det du trenger å vite", readMore: "Les mer", interestsLabel: "Basert på dine interesser", ask: (p) => `Spør ${p} om hva som helst`, interestQuestion: "Hva er den siste utviklingen i denne saken?" },
	he: { title: "מה שצריך לדעת", readMore: "קרא עוד", interestsLabel: "בהתאם לתחומי העניין שלך", ask: (p) => `שאלו את ${p} כל דבר`, interestQuestion: "מה ההתפתחויות האחרונות בסיפור הזה?" },
	id: { title: "Yang perlu Anda ketahui", readMore: "Baca selengkapnya", interestsLabel: "Berdasarkan minat Anda", ask: (p) => `Tanyakan apa saja kepada ${p}`, interestQuestion: "Apa perkembangan terbaru dari berita ini?" },
	ms: { title: "Apa yang perlu anda tahu", readMore: "Baca lagi", interestsLabel: "Berdasarkan minat anda", ask: (p) => `Tanya ${p} apa sahaja`, interestQuestion: "Apakah perkembangan terkini cerita ini?" },
	tl: { title: "Ang kailangan mong malaman", readMore: "Magbasa pa", interestsLabel: "Batay sa iyong mga interes", ask: (p) => `Magtanong sa ${p} ng kahit ano`, interestQuestion: "Ano ang pinakabagong mga pangyayari sa kwentong ito?" },
	hu: { title: "Amit tudnod kell", readMore: "Tovább olvasom", interestsLabel: "Érdeklődési köröd alapján", ask: (p) => `Kérdezz bármit a ${p}-tól`, interestQuestion: "Mik a legújabb fejlemények ebben a történetben?" },
	el: { title: "Τι πρέπει να ξέρετε", readMore: "Διαβάστε περισσότερα", interestsLabel: "Με βάση τα ενδιαφέροντά σας", ask: (p) => `Ρωτήστε τo ${p} ό,τι θέλετε`, interestQuestion: "Ποιες είναι οι τελευταίες εξελίξεις;" },
	bg: { title: "Какво трябва да знаете", readMore: "Прочетете повече", interestsLabel: "Въз основа на вашите интереси", ask: (p) => `Попитайте ${p} каквото и да е`, interestQuestion: "Какви са последните развития в тази история?" },
	sr: { title: "Šta treba da znate", readMore: "Pročitajte više", interestsLabel: "Na osnovu vaših interesovanja", ask: (p) => `Pitajte ${p} bilo šta`, interestQuestion: "Koji su najnoviji događaji u ovoj priči?" },
	hr: { title: "Što trebate znati", readMore: "Pročitajte više", interestsLabel: "Na temelju vaših interesa", ask: (p) => `Pitajte ${p} bilo što`, interestQuestion: "Koji su najnoviji razvoji u ovoj priči?" },
	sk: { title: "Čo potrebujete vedieť", readMore: "Čítať ďalej", interestsLabel: "Na základe vašich záujmov", ask: (p) => `Opýtajte sa ${p} čokoľvek`, interestQuestion: "Aký je najnovší vývoj v tomto príbehu?" },
	ta: { title: "நீங்கள் தெரிந்து கொள்ள வேண்டியவை", readMore: "மேலும் படிக்க", interestsLabel: "உங்கள் ஆர்வங்களின் அடிப்படையில்", ask: (p) => `${p}-இடம் எதையும் கேளுங்கள்`, interestQuestion: "இந்தச் செய்தியின் சமீபத்திய முன்னேற்றங்கள் என்ன?" },
	te: { title: "మీరు తెలుసుకోవలసినవి", readMore: "మరింత చదవండి", interestsLabel: "మీ ఆసక్తుల ఆధారంగా", ask: (p) => `${p}ని ఏదైనా అడగండి`, interestQuestion: "ఈ కథలో తాజా పరిణామాలు ఏమిటి?" },
	mr: { title: "तुम्हाला काय माहीत असणे आवश्यक आहे", readMore: "अधिक वाचा", interestsLabel: "तुमच्या आवडीनुसार", ask: (p) => `${p}ला काहीही विचारा`, interestQuestion: "या कथेतील ताज्या घडामोडी काय आहेत?" },
	gu: { title: "તમારે શું જાણવું જોઈએ", readMore: "વધુ વાંચો", interestsLabel: "તમારી રુચિઓના આધારે", ask: (p) => `${p}ને કંઈ પણ પૂછો`, interestQuestion: "આ વાર્તાના તાજેતરના વિકાસ શું છે?" },
	ur: { title: "آپ کو کیا جاننے کی ضرورت ہے", readMore: "مزید پڑھیں", interestsLabel: "آپ کی دلچسپیوں کی بنیاد پر", ask: (p) => `${p} سے کچھ بھی پوچھیں`, interestQuestion: "اس کہانی میں تازہ ترین پیش رفت کیا ہے؟" },
	fa: { title: "آنچه باید بدانید", readMore: "ادامه مطلب", interestsLabel: "بر اساس علایق شما", ask: (p) => `از ${p} هر چیزی بپرسید`, interestQuestion: "آخرین تحولات این داستان چیست؟" },
	sw: { title: "Unachohitaji kujua", readMore: "Soma zaidi", interestsLabel: "Kulingana na maslahi yako", ask: (p) => `Uliza ${p} chochote`, interestQuestion: "Maendeleo ya hivi karibuni ya habari hii ni yapi?" },
};

function getWidgetStrings(lang, publication) {
	const strings = WIDGET_I18N[lang] || WIDGET_I18N.en;
	return {
		title: strings.title,
		readMore: strings.readMore,
		interestsLabel: strings.interestsLabel,
		askPlaceholder: strings.ask(publication),
		interestQuestion: strings.interestQuestion,
	};
}

export function parseArgs(argv) {
	const out = {
		url: "",
		output: "page-with-widget.png",
		waitUntil: "networkidle2",
		timeout: 45_000,
		publication: "Daily Star",
	};
	for (let i = 2; i < argv.length; i++) {
		const a = argv[i];
		const next = argv[i + 1];
		if (a === "--url" || a === "-u") {
			out.url = next ?? "";
			i++;
		} else if (a === "--out" || a === "-o") {
			out.output = next ?? out.output;
			i++;
		} else if (a === "--timeout" || a === "-t") {
			out.timeout = Number(next) || out.timeout;
			i++;
		} else if (a === "--wait" || a === "-w") {
			const w = next;
			if (w === "load" || w === "domcontentloaded" || w === "networkidle0" || w === "networkidle2") {
				out.waitUntil = w;
			}
			i++;
		} else if (a === "--publication" || a === "-p") {
			out.publication = next ?? out.publication;
			i++;
		} else if (a === "--help" || a === "-h") {
			console.log(`Usage: node capture.mjs --url <https://...> [--out file.png] [--wait networkidle2|domcontentloaded|load] [--timeout ms] [--publication "Daily Star"]

Captures the article region as PNG after the CMP/consent layer is gone and network has settled, then injects the widget below og:image (fallback: largest image).`);
			process.exit(0);
		}
	}
	return out;
}

function assertHttpUrl(urlString) {
	let u;
	try {
		u = new URL(urlString);
	} catch {
		throw new Error("Invalid URL");
	}
	if (u.protocol !== "http:" && u.protocol !== "https:") {
		throw new Error("Only http(s) URLs are allowed");
	}
	return u.href;
}

/**
 * Extract all sentences from body paragraphs, split cleanly.
 */
function extractSentences(paragraphs) {
	const all = [];
	for (const p of paragraphs) {
		const matches = p.match(/[^.!?]+[.!?]+/g);
		if (matches) all.push(...matches.map(s => s.trim()).filter(s => s.length > 20));
	}
	return all;
}

/**
 * Build a ~250-word summary from the article body paragraphs.
 */
const SUMMARY_FALLBACK = {
	en: "This article covers the following key points.",
	fr: "Cet article couvre les points clés suivants.",
	de: "Dieser Artikel behandelt die folgenden wichtigen Punkte.",
	es: "Este artículo cubre los siguientes puntos clave.",
	it: "Questo articolo copre i seguenti punti chiave.",
	pt: "Este artigo cobre os seguintes pontos-chave.",
	nl: "Dit artikel behandelt de volgende kernpunten.",
	ar: "يغطي هذا المقال النقاط الرئيسية التالية.",
	ja: "この記事は以下の重要なポイントをカバーしています。",
	ko: "이 기사는 다음과 같은 주요 사항을 다루고 있습니다.",
	zh: "本文涵盖以下要点。",
	hi: "यह लेख निम्नलिखित मुख्य बिंदुओं को कवर करता है।",
	bn: "এই নিবন্ধটি নিম্নলিখিত মূল বিষয়গুলি কভার করে।",
	ru: "В этой статье рассматриваются следующие ключевые моменты.",
	tr: "Bu makale şu önemli noktaları ele almaktadır.",
	vi: "Bài viết này đề cập đến các điểm chính sau đây.",
	th: "บทความนี้ครอบคลุมประเด็นสำคัญดังต่อไปนี้",
	pl: "Ten artykuł omawia następujące kluczowe kwestie.",
	uk: "Ця стаття висвітлює наступні ключові моменти.",
	ro: "Acest articol acoperă următoarele puncte cheie.",
	cs: "Tento článek pokrývá následující klíčové body.",
	sv: "Den här artikeln täcker följande nyckelpunkter.",
	da: "Denne artikel dækker følgende nøglepunkter.",
	fi: "Tämä artikkeli kattaa seuraavat keskeiset asiat.",
	no: "Denne artikkelen dekker følgende nøkkelpunkter.",
	he: "כתבה זו מכסה את הנקודות המרכזיות הבאות.",
	id: "Artikel ini membahas poin-poin kunci berikut.",
	ms: "Artikel ini merangkumi perkara penting berikut.",
	hu: "Ez a cikk a következő kulcsfontosságú pontokat tárgyalja.",
	el: "Αυτό το άρθρο καλύπτει τα ακόλουθα βασικά σημεία.",
	fa: "این مقاله نکات کلیدی زیر را پوشش می‌دهد.",
	sw: "Makala hii inashughulikia mambo muhimu yafuatayo.",
};

function lowercaseFirst(s, lang = "en") {
	if (!s) return s;
	if (lang === "de") return s;
	const words = s.split(/\s+/);
	if (words.length <= 3) return s;
	if (/^[A-ZÀ-ÖØ-Þ]/.test(words[0]) && !/^[A-ZÀ-ÖØ-Þ]{2,}/.test(words[0])) {
		words[0] = words[0][0].toLowerCase() + words[0].slice(1);
	}
	return words.join(" ");
}

function cleanHeadline(headline) {
	let h = headline.replace(/\s*[|]\s*.*$/, "").trim();
	if (h.includes(":")) {
		const afterColon = h.split(":").slice(1).join(":").trim();
		if (afterColon.length > 15) h = afterColon;
	}
	if (h.includes(" – ")) {
		const afterDash = h.split(" – ").slice(1).join(" – ").trim();
		if (afterDash.length > 15) h = afterDash;
	}
	return h.replace(/[.!?]+$/, "").trim();
}

function condenseSentence(sentence) {
	let s = sentence.trim();
	s = s.replace(/^(Einst|Doch|Jedoch|Allerdings|Außerdem|Zudem|Dabei|Darüber hinaus|Cependant|Toutefois|En outre|Par ailleurs|D'autre part|De plus|However|Moreover|Furthermore|In addition|Meanwhile|Additionally|Nevertheless|As a result|Consequently|Subsequently|According to [^,]+,)\s+/i, "");
	// Take main clause before subordinate conjunctions
	const clauseSep = /,\s*(?:wobei|während|obwohl|wenngleich|qui|dont|où|lequel|laquelle|which|although|whereas|while|though|unless)\s/i;
	const parts = s.split(clauseSep);
	if (parts[0].split(/\s+/).length >= 6) s = parts[0].trim();
	// Strip trailing parentheticals
	s = s.replace(/\s*\([^)]{10,}\)\s*/g, " ").trim();
	// Trim appositive clauses (", who …," or ", der …,")
	s = s.replace(/,\s*(?:who|der|die|das|qui|que|which)\s+[^,]{5,},/gi, ",");
	if (!/[.!?。]$/.test(s)) s += ".";
	return s.replace(/\s+/g, " ");
}

function scoreSentence(sentence, idx, total) {
	let score = 0;
	const numMatches = sentence.match(/\d[\d.,]*/g);
	if (numMatches) score += 2 + Math.min(numMatches.length, 3);
	const caps = sentence.match(/[A-ZÀ-ÖØ-Þ][a-zà-öø-ÿ]{2,}/g);
	if (caps) score += Math.min(caps.length, 3);
	if (sentence.length > 50 && sentence.length < 180) score += 2;
	if (sentence.length >= 200) score -= 2;
	if (sentence.length < 35) score -= 3;
	if (/["«»„""']/.test(sentence)) score -= 3;
	// Penalise opening sentences the reader already saw
	const pos = idx / Math.max(total, 1);
	if (pos < 0.1) score -= 3;
	else if (pos < 0.2) score -= 1;
	else if (pos > 0.85) score -= 1;
	return score;
}

const PROMO_RE = /\b(profitez|abonnez|inscrivez|newsletter|subscribe|sign\s*up|gratis|kostenlos|jetzt\s+bestellen|grilles|sudoku|kreuzworträtsel|gewinnspiel|angebot|rabatt|coupon|promo|sponsor|anzeige|werbung|cookie|datenschutz|privacy|terms\s+of\s+use|nutzungsbedingungen|impressum)\b/i;

function buildSummary(paragraphs, headline = "", lang = "en") {
	const fallback = SUMMARY_FALLBACK[lang] || SUMMARY_FALLBACK.en;

	const allSentences = [];
	for (const p of paragraphs) {
		const sents = p.split(/(?<=[.!?。])\s+/).filter(s => s.length > 25);
		for (const s of sents) {
			if (!PROMO_RE.test(s)) allSentences.push(s);
		}
	}

	if (allSentences.length === 0) return headline || "";

	const scored = allSentences.map((s, i) => ({
		text: s.trim().replace(/\s+/g, " "),
		score: scoreSentence(s, i, allSentences.length),
		idx: i,
	}));

	scored.sort((a, b) => b.score - a.score || a.idx - b.idx);

	const selected = [];
	const usedTexts = new Set();

	const headlineWords = headline
		? new Set(headline.toLowerCase().split(/\s+/).filter(w => w.length > 3))
		: new Set();

	for (const item of scored) {
		if (selected.length >= 6) break;

		const words = item.text.toLowerCase().split(/\s+/);

		let tooSimilar = false;
		for (const prev of usedTexts) {
			const prevWords = new Set(prev.toLowerCase().split(/\s+/));
			const overlap = words.filter(w => w.length > 3 && prevWords.has(w)).length;
			if (overlap > words.length * 0.4) { tooSimilar = true; break; }
		}
		if (tooSimilar) continue;

		usedTexts.add(item.text);
		selected.push(item);
	}

	selected.sort((a, b) => a.idx - b.idx);

	// Use the headline as the opening — it's the journalist's own
	// summary and is always different from the article body text
	let opening = "";
	const cleaned = cleanHeadline(headline);
	if (cleaned && cleaned.length > 10 && cleaned.length < 200) {
		opening = cleaned + (/[.!?]$/.test(cleaned) ? "" : ".");
	} else {
		opening = fallback;
	}

	const parts = [opening];
	let wordCount = opening.split(/\s+/).length;

	for (const item of selected) {
		const condensed = condenseSentence(item.text);
		const sentWords = condensed.split(/\s+/).length;
		if (wordCount + sentWords > 260) break;
		parts.push(condensed);
		wordCount += sentWords;
	}

	return parts.join(" ");
}

/**
 * Generate 2 comprehension-style questions whose answers are found
 * in the article. These read like "did you actually read it?" tests.
 *
 * Every candidate passes through coherence guardrails before being accepted.
 */
const QUESTION_TEMPLATES = {
	fr: { who: (n) => `Qui est ${n} ?`, whatHappened: (p) => `Que s'est-il passé à ${p} ?`, howMany: (n) => `Combien de ${n} sont mentionnés dans l'article ?`, mainIssue: "Quel est le sujet principal de cet article ?", response: "Quelles mesures ont été prises ?", impact: "Quel impact cela pourrait-il avoir à l'avenir ?", keyFigures: "Qui sont les personnages clés mentionnés ?", nextSteps: "Quelles sont les prochaines étapes attendues ?" },
	de: { who: (n) => `Wer ist ${n}?`, whatHappened: (p) => `Was geschah in ${p}?`, howMany: (n) => `Wie viele ${n} werden im Artikel erwähnt?`, mainIssue: "Was ist das Hauptthema dieses Artikels?", response: "Welche Maßnahmen wurden ergriffen?", impact: "Welche Auswirkungen könnte dies in Zukunft haben?", keyFigures: "Wer sind die wichtigsten Personen in diesem Artikel?", nextSteps: "Was sind die nächsten erwarteten Entwicklungen?" },
	es: { who: (n) => `¿Quién es ${n}?`, whatHappened: (p) => `¿Qué ocurrió en ${p}?`, howMany: (n) => `¿Cuántos ${n} se mencionan en el artículo?`, mainIssue: "¿Cuál es el tema principal de este artículo?", response: "¿Qué medidas se han tomado?", impact: "¿Qué impacto podría tener esto en el futuro?", keyFigures: "¿Quiénes son las figuras clave mencionadas?", nextSteps: "¿Cuáles son los próximos pasos esperados?" },
	it: { who: (n) => `Chi è ${n}?`, whatHappened: (p) => `Cosa è successo a ${p}?`, howMany: (n) => `Quanti ${n} sono menzionati nell'articolo?`, mainIssue: "Qual è il tema principale di questo articolo?", response: "Quali misure sono state prese?", impact: "Quale impatto potrebbe avere in futuro?", keyFigures: "Chi sono le figure chiave menzionate?", nextSteps: "Quali sono i prossimi sviluppi attesi?" },
	pt: { who: (n) => `Quem é ${n}?`, whatHappened: (p) => `O que aconteceu em ${p}?`, howMany: (n) => `Quantos ${n} são mencionados no artigo?`, mainIssue: "Qual é o tema principal deste artigo?", response: "Que medidas foram tomadas?", impact: "Que impacto isso pode ter no futuro?", keyFigures: "Quem são as figuras-chave mencionadas?", nextSteps: "Quais são os próximos desenvolvimentos esperados?" },
	nl: { who: (n) => `Wie is ${n}?`, whatHappened: (p) => `Wat gebeurde er in ${p}?`, howMany: (n) => `Hoeveel ${n} worden in het artikel genoemd?`, mainIssue: "Wat is het hoofdonderwerp van dit artikel?", response: "Welke maatregelen zijn er genomen?", impact: "Welke impact zou dit kunnen hebben?", keyFigures: "Wie zijn de belangrijkste personen?", nextSteps: "Wat zijn de verwachte volgende stappen?" },
	ar: { who: (n) => `من هو ${n}؟`, whatHappened: (p) => `ماذا حدث في ${p}؟`, howMany: (n) => `كم عدد ${n} المذكورة في المقال؟`, mainIssue: "ما هو الموضوع الرئيسي لهذا المقال؟", response: "ما هي الإجراءات التي اتخذت؟", impact: "ما هو التأثير المحتمل في المستقبل؟", keyFigures: "من هم الشخصيات الرئيسية؟", nextSteps: "ما هي الخطوات التالية المتوقعة؟" },
	ja: { who: (n) => `${n}とは誰ですか？`, whatHappened: (p) => `${p}で何が起きましたか？`, howMany: (n) => `記事で言及されている${n}はいくつですか？`, mainIssue: "この記事の主なテーマは何ですか？", response: "どのような対策が取られましたか？", impact: "今後どのような影響がありますか？", keyFigures: "記事に登場する主要人物は誰ですか？", nextSteps: "次に予想される展開は何ですか？" },
	ko: { who: (n) => `${n}은(는) 누구인가요?`, whatHappened: (p) => `${p}에서 무슨 일이 일어났나요?`, howMany: (n) => `기사에서 언급된 ${n}은(는) 몇 개인가요?`, mainIssue: "이 기사의 주요 주제는 무엇인가요?", response: "어떤 조치가 취해졌나요?", impact: "향후 어떤 영향을 미칠 수 있나요?", keyFigures: "기사에 언급된 주요 인물은 누구인가요?", nextSteps: "다음에 예상되는 전개는 무엇인가요?" },
	zh: { who: (n) => `${n}是谁？`, whatHappened: (p) => `${p}发生了什么？`, howMany: (n) => `文章中提到了多少${n}？`, mainIssue: "这篇文章的主要议题是什么？", response: "采取了哪些措施？", impact: "这可能会产生什么影响？", keyFigures: "文章中提到的关键人物是谁？", nextSteps: "预计下一步会有什么进展？" },
	hi: { who: (n) => `${n} कौन है?`, whatHappened: (p) => `${p} में क्या हुआ?`, howMany: (n) => `लेख में कितने ${n} का उल्लेख है?`, mainIssue: "इस लेख का मुख्य विषय क्या है?", response: "क्या कदम उठाए गए हैं?", impact: "भविष्य में इसका क्या प्रभाव हो सकता है?", keyFigures: "लेख में उल्लिखित प्रमुख व्यक्ति कौन हैं?", nextSteps: "अगले अपेक्षित कदम क्या हैं?" },
	bn: { who: (n) => `${n} কে?`, whatHappened: (p) => `${p}-তে কী ঘটেছে?`, howMany: (n) => `নিবন্ধে কতগুলি ${n} উল্লেখ করা হয়েছে?`, mainIssue: "এই নিবন্ধের মূল বিষয় কী?", response: "কী পদক্ষেপ নেওয়া হয়েছে?", impact: "ভবিষ্যতে এর কী প্রভাব পড়তে পারে?", keyFigures: "নিবন্ধে উল্লিখিত প্রধান ব্যক্তিরা কারা?", nextSteps: "পরবর্তী প্রত্যাশিত পদক্ষেপ কী?" },
	ru: { who: (n) => `Кто такой ${n}?`, whatHappened: (p) => `Что произошло в ${p}?`, howMany: (n) => `Сколько ${n} упомянуто в статье?`, mainIssue: "Какова основная тема этой статьи?", response: "Какие меры были приняты?", impact: "Какое влияние это может оказать в будущем?", keyFigures: "Кто ключевые фигуры в этой статье?", nextSteps: "Какие следующие шаги ожидаются?" },
	tr: { who: (n) => `${n} kimdir?`, whatHappened: (p) => `${p}'da ne oldu?`, howMany: (n) => `Makalede kaç ${n} bahsediliyor?`, mainIssue: "Bu makalenin ana konusu nedir?", response: "Hangi önlemler alındı?", impact: "Bu gelecekte nasıl bir etki yaratabilir?", keyFigures: "Makalede adı geçen kilit isimler kimler?", nextSteps: "Beklenen bir sonraki gelişme nedir?" },
	vi: { who: (n) => `${n} là ai?`, whatHappened: (p) => `Điều gì đã xảy ra tại ${p}?`, howMany: (n) => `Có bao nhiêu ${n} được đề cập trong bài viết?`, mainIssue: "Chủ đề chính của bài viết này là gì?", response: "Những biện pháp nào đã được thực hiện?", impact: "Điều này có thể tác động gì trong tương lai?", keyFigures: "Nhân vật chính trong bài viết là ai?", nextSteps: "Bước tiếp theo dự kiến là gì?" },
	th: { who: (n) => `${n} คือใคร?`, whatHappened: (p) => `เกิดอะไรขึ้นที่ ${p}?`, howMany: (n) => `มี ${n} กี่รายการที่กล่าวถึงในบทความ?`, mainIssue: "หัวข้อหลักของบทความนี้คืออะไร?", response: "มีมาตรการอะไรบ้างที่ถูกดำเนินการ?", impact: "สิ่งนี้อาจส่งผลกระทบอย่างไรในอนาคต?", keyFigures: "บุคคลสำคัญที่กล่าวถึงในบทความคือใคร?", nextSteps: "ขั้นตอนต่อไปที่คาดว่าจะเกิดขึ้นคืออะไร?" },
	pl: { who: (n) => `Kim jest ${n}?`, whatHappened: (p) => `Co wydarzyło się w ${p}?`, howMany: (n) => `Ile ${n} wymieniono w artykule?`, mainIssue: "Jaki jest główny temat tego artykułu?", response: "Jakie działania zostały podjęte?", impact: "Jaki wpływ może to mieć w przyszłości?", keyFigures: "Kim są kluczowe postacie wymienione w artykule?", nextSteps: "Jakie są oczekiwane kolejne kroki?" },
	uk: { who: (n) => `Хто такий ${n}?`, whatHappened: (p) => `Що сталося в ${p}?`, howMany: (n) => `Скільки ${n} згадано у статті?`, mainIssue: "Яка основна тема цієї статті?", response: "Які заходи було вжито?", impact: "Який вплив це може мати в майбутньому?", keyFigures: "Хто є ключовими фігурами у цій статті?", nextSteps: "Які наступні кроки очікуються?" },
	ro: { who: (n) => `Cine este ${n}?`, whatHappened: (p) => `Ce s-a întâmplat în ${p}?`, howMany: (n) => `Câte ${n} sunt menționate în articol?`, mainIssue: "Care este subiectul principal al acestui articol?", response: "Ce măsuri au fost luate?", impact: "Ce impact ar putea avea în viitor?", keyFigures: "Cine sunt figurile cheie menționate?", nextSteps: "Care sunt pașii următori așteptați?" },
	cs: { who: (n) => `Kdo je ${n}?`, whatHappened: (p) => `Co se stalo v ${p}?`, howMany: (n) => `Kolik ${n} je v článku zmíněno?`, mainIssue: "Jaké je hlavní téma tohoto článku?", response: "Jaká opatření byla přijata?", impact: "Jaký dopad by to mohlo mít v budoucnu?", keyFigures: "Kdo jsou klíčové osoby v tomto článku?", nextSteps: "Jaké jsou očekávané další kroky?" },
	sv: { who: (n) => `Vem är ${n}?`, whatHappened: (p) => `Vad hände i ${p}?`, howMany: (n) => `Hur många ${n} nämns i artikeln?`, mainIssue: "Vad är huvudtemat i denna artikel?", response: "Vilka åtgärder har vidtagits?", impact: "Vilken påverkan kan detta ha i framtiden?", keyFigures: "Vilka är nyckelpersonerna i artikeln?", nextSteps: "Vilka är de förväntade nästa stegen?" },
	da: { who: (n) => `Hvem er ${n}?`, whatHappened: (p) => `Hvad skete der i ${p}?`, howMany: (n) => `Hvor mange ${n} nævnes i artiklen?`, mainIssue: "Hvad er hovedemnet i denne artikel?", response: "Hvilke foranstaltninger er blevet truffet?", impact: "Hvilken indvirkning kan dette have i fremtiden?", keyFigures: "Hvem er nøglepersonerne i artiklen?", nextSteps: "Hvad er de forventede næste skridt?" },
	fi: { who: (n) => `Kuka on ${n}?`, whatHappened: (p) => `Mitä tapahtui ${p}:ssa?`, howMany: (n) => `Kuinka monta ${n} artikkelissa mainitaan?`, mainIssue: "Mikä on tämän artikkelin pääaihe?", response: "Mitä toimenpiteitä on toteutettu?", impact: "Millaisia vaikutuksia tällä voi olla tulevaisuudessa?", keyFigures: "Ketkä ovat artikkelin avainhenkilöt?", nextSteps: "Mitkä ovat odotettavissa olevat seuraavat vaiheet?" },
	no: { who: (n) => `Hvem er ${n}?`, whatHappened: (p) => `Hva skjedde i ${p}?`, howMany: (n) => `Hvor mange ${n} nevnes i artikkelen?`, mainIssue: "Hva er hovedtemaet i denne artikkelen?", response: "Hvilke tiltak har blitt iverksatt?", impact: "Hvilken innvirkning kan dette ha i fremtiden?", keyFigures: "Hvem er nøkkelpersonene i artikkelen?", nextSteps: "Hva er de forventede neste stegene?" },
	he: { who: (n) => `מי הוא ${n}?`, whatHappened: (p) => `מה קרה ב${p}?`, howMany: (n) => `כמה ${n} מוזכרים בכתבה?`, mainIssue: "מהו הנושא המרכזי של כתבה זו?", response: "אילו צעדים ננקטו?", impact: "מה עשויה להיות ההשפעה בעתיד?", keyFigures: "מיהם הדמויות המרכזיות בכתבה?", nextSteps: "מהם הצעדים הבאים הצפויים?" },
	id: { who: (n) => `Siapa ${n}?`, whatHappened: (p) => `Apa yang terjadi di ${p}?`, howMany: (n) => `Berapa banyak ${n} yang disebutkan dalam artikel?`, mainIssue: "Apa topik utama artikel ini?", response: "Langkah apa yang telah diambil?", impact: "Apa dampak yang mungkin terjadi di masa depan?", keyFigures: "Siapa saja tokoh kunci yang disebutkan?", nextSteps: "Apa langkah selanjutnya yang diharapkan?" },
	ms: { who: (n) => `Siapakah ${n}?`, whatHappened: (p) => `Apa yang berlaku di ${p}?`, howMany: (n) => `Berapa banyak ${n} yang disebut dalam artikel?`, mainIssue: "Apakah topik utama artikel ini?", response: "Apakah langkah yang telah diambil?", impact: "Apakah kesan yang mungkin berlaku pada masa hadapan?", keyFigures: "Siapakah tokoh utama yang disebut?", nextSteps: "Apakah langkah seterusnya yang dijangka?" },
	tl: { who: (n) => `Sino si ${n}?`, whatHappened: (p) => `Ano ang nangyari sa ${p}?`, howMany: (n) => `Ilan ang ${n} na binanggit sa artikulo?`, mainIssue: "Ano ang pangunahing paksa ng artikulong ito?", response: "Anong mga hakbang ang ginawa?", impact: "Anong epekto ang maaaring idulot nito sa hinaharap?", keyFigures: "Sino ang mga pangunahing taong binanggit?", nextSteps: "Ano ang mga inaasahang susunod na hakbang?" },
	hu: { who: (n) => `Ki az a ${n}?`, whatHappened: (p) => `Mi történt ${p}-ban?`, howMany: (n) => `Hány ${n} szerepel a cikkben?`, mainIssue: "Mi a cikk fő témája?", response: "Milyen intézkedéseket tettek?", impact: "Milyen hatása lehet ennek a jövőben?", keyFigures: "Kik a cikkben említett kulcsfigurák?", nextSteps: "Mik a várt következő lépések?" },
	el: { who: (n) => `Ποιος είναι ο ${n};`, whatHappened: (p) => `Τι συνέβη στ${p};`, howMany: (n) => `Πόσα ${n} αναφέρονται στο άρθρο;`, mainIssue: "Ποιο είναι το κύριο θέμα αυτού του άρθρου;", response: "Ποια μέτρα έχουν ληφθεί;", impact: "Τι αντίκτυπο θα μπορούσε να έχει στο μέλλον;", keyFigures: "Ποια είναι τα βασικά πρόσωπα που αναφέρονται;", nextSteps: "Ποια είναι τα αναμενόμενα επόμενα βήματα;" },
	bg: { who: (n) => `Кой е ${n}?`, whatHappened: (p) => `Какво се случи в ${p}?`, howMany: (n) => `Колко ${n} са споменати в статията?`, mainIssue: "Каква е основната тема на тази статия?", response: "Какви мерки бяха предприети?", impact: "Какво въздействие може да има това в бъдеще?", keyFigures: "Кои са ключовите фигури в тази статия?", nextSteps: "Какви са очакваните следващи стъпки?" },
	sr: { who: (n) => `Ko je ${n}?`, whatHappened: (p) => `Šta se desilo u ${p}?`, howMany: (n) => `Koliko ${n} je pomenuto u članku?`, mainIssue: "Koja je glavna tema ovog članka?", response: "Koje mere su preduzete?", impact: "Kakav uticaj bi ovo moglo imati u budućnosti?", keyFigures: "Ko su ključne figure pomenute u članku?", nextSteps: "Koji su očekivani sledeći koraci?" },
	hr: { who: (n) => `Tko je ${n}?`, whatHappened: (p) => `Što se dogodilo u ${p}?`, howMany: (n) => `Koliko ${n} je navedeno u članku?`, mainIssue: "Koja je glavna tema ovog članka?", response: "Koje su mjere poduzete?", impact: "Kakav bi utjecaj ovo moglo imati u budućnosti?", keyFigures: "Tko su ključne osobe navedene u članku?", nextSteps: "Koji su očekivani sljedeći koraci?" },
	sk: { who: (n) => `Kto je ${n}?`, whatHappened: (p) => `Čo sa stalo v ${p}?`, howMany: (n) => `Koľko ${n} sa v článku spomína?`, mainIssue: "Aká je hlavná téma tohto článku?", response: "Aké opatrenia boli prijaté?", impact: "Aký dopad by to mohlo mať v budúcnosti?", keyFigures: "Kto sú kľúčové osoby v tomto článku?", nextSteps: "Aké sú očakávané ďalšie kroky?" },
	fa: { who: (n) => `${n} کیست؟`, whatHappened: (p) => `در ${p} چه اتفاقی افتاد؟`, howMany: (n) => `چند ${n} در مقاله ذکر شده است؟`, mainIssue: "موضوع اصلی این مقاله چیست؟", response: "چه اقداماتی انجام شده است؟", impact: "این موضوع چه تأثیری در آینده خواهد داشت؟", keyFigures: "شخصیت‌های کلیدی ذکر شده در مقاله چه کسانی هستند؟", nextSteps: "گام‌های بعدی مورد انتظار چیست؟" },
	sw: { who: (n) => `${n} ni nani?`, whatHappened: (p) => `Nini kilitokea ${p}?`, howMany: (n) => `${n} ngapi zimetajwa katika makala?`, mainIssue: "Mada kuu ya makala hii ni ipi?", response: "Hatua gani zimechukuliwa?", impact: "Athari gani hii inaweza kuwa nayo katika siku zijazo?", keyFigures: "Watu muhimu waliotajwa katika makala ni akina nani?", nextSteps: "Hatua zinazotarajiwa zifuatazo ni zipi?" },
	ta: { who: (n) => `${n} யார்?`, whatHappened: (p) => `${p}-இல் என்ன நடந்தது?`, howMany: (n) => `கட்டுரையில் எத்தனை ${n} குறிப்பிடப்பட்டுள்ளன?`, mainIssue: "இந்தக் கட்டுரையின் முக்கிய தலைப்பு என்ன?", response: "என்ன நடவடிக்கைகள் எடுக்கப்பட்டன?", impact: "இது எதிர்காலத்தில் என்ன தாக்கத்தை ஏற்படுத்தலாம்?", keyFigures: "கட்டுரையில் குறிப்பிடப்பட்ட முக்கிய நபர்கள் யார்?", nextSteps: "எதிர்பார்க்கப்படும் அடுத்த படிகள் என்ன?" },
	te: { who: (n) => `${n} ఎవరు?`, whatHappened: (p) => `${p}లో ఏమి జరిగింది?`, howMany: (n) => `వ్యాసంలో ఎన్ని ${n} ప్రస్తావించబడ్డాయి?`, mainIssue: "ఈ వ్యాసం యొక్క ప్రధాన అంశం ఏమిటి?", response: "ఏ చర్యలు తీసుకోబడ్డాయి?", impact: "భవిష్యత్తులో దీని ప్రభావం ఏమిటి?", keyFigures: "వ్యాసంలో ప్రస్తావించిన ముఖ్య వ్యక్తులు ఎవరు?", nextSteps: "తదుపరి ఆశించిన అడుగులు ఏమిటి?" },
	ur: { who: (n) => `${n} کون ہے؟`, whatHappened: (p) => `${p} میں کیا ہوا؟`, howMany: (n) => `مضمون میں کتنے ${n} کا ذکر ہے؟`, mainIssue: "اس مضمون کا بنیادی موضوع کیا ہے؟", response: "کیا اقدامات کیے گئے ہیں؟", impact: "مستقبل میں اس کا کیا اثر ہو سکتا ہے؟", keyFigures: "مضمون میں ذکر شدہ اہم شخصیات کون ہیں؟", nextSteps: "اگلے متوقع اقدامات کیا ہیں؟" },
};

const SPEECH_VERBS_BY_LANG = {
	de: /\b(sagte|erklärte|betonte|meinte|äußerte|kommentierte|warnte|forderte|kritisierte|lobte|beschrieb|berichtete|bestätigte|schrieb|fragte|reagierte|nannte|bezeichnete|teilte|verkündete|beklagte|dementierte|mitteilte)\b/i,
	fr: /\b(a\s+dit|a\s+déclaré|a\s+expliqué|a\s+souligné|a\s+affirmé|a\s+annoncé|a\s+averti|a\s+critiqué|a\s+confirmé|a\s+indiqué|a\s+précisé|a\s+estimé|a\s+rappelé)\b/i,
	es: /\b(dijo|declaró|explicó|afirmó|anunció|advirtió|criticó|confirmó|indicó|señaló|subrayó|aseguró|agregó)\b/i,
	it: /\b(ha\s+detto|ha\s+dichiarato|ha\s+spiegato|ha\s+affermato|ha\s+annunciato|ha\s+confermato|ha\s+sottolineato|ha\s+precisato)\b/i,
	pt: /\b(disse|declarou|explicou|afirmou|anunciou|alertou|criticou|confirmou|sublinhou|acrescentou)\b/i,
	nl: /\b(zei|verklaarde|bevestigde|waarschuwde|bekritiseerde|benadrukte|meldde)\b/i,
	ru: /\b(сказал|заявил|объяснил|подтвердил|предупредил|сообщил|отметил|подчеркнул|указал)\b/i,
	pl: /\b(powiedział|oświadczył|wyjaśnił|potwierdził|ostrzegł|podkreślił|dodał|stwierdził|zaznaczył)\b/i,
	tr: /\b(dedi|açıkladı|belirtti|uyardı|vurguladı|doğruladı|bildirdi|söyledi)\b/i,
};

const QUESTION_EXTRAS = {
	de: { whatSaid: (n) => `Was hat ${n} erklärt?`, whatRole: (n) => `Welche Rolle spielt ${n}?`, whySignificant: "Warum ist das bedeutsam?", whatConsequences: "Welche Folgen könnte dies haben?" },
	fr: { whatSaid: (n) => `Qu'a déclaré ${n} ?`, whatRole: (n) => `Quel rôle joue ${n} ?`, whySignificant: "Pourquoi est-ce important ?", whatConsequences: "Quelles conséquences cela pourrait-il avoir ?" },
	es: { whatSaid: (n) => `¿Qué declaró ${n}?`, whatRole: (n) => `¿Qué papel juega ${n}?`, whySignificant: "¿Por qué es esto importante?", whatConsequences: "¿Cuáles podrían ser las consecuencias?" },
	it: { whatSaid: (n) => `Cosa ha dichiarato ${n}?`, whatRole: (n) => `Che ruolo ha ${n}?`, whySignificant: "Perché è significativo?", whatConsequences: "Quali conseguenze potrebbe avere?" },
	pt: { whatSaid: (n) => `O que declarou ${n}?`, whatRole: (n) => `Qual é o papel de ${n}?`, whySignificant: "Por que isso é significativo?", whatConsequences: "Quais podem ser as consequências?" },
	nl: { whatSaid: (n) => `Wat heeft ${n} verklaard?`, whatRole: (n) => `Welke rol speelt ${n}?`, whySignificant: "Waarom is dit belangrijk?", whatConsequences: "Wat kunnen de gevolgen zijn?" },
	ru: { whatSaid: (n) => `Что заявил ${n}?`, whatRole: (n) => `Какую роль играет ${n}?`, whySignificant: "Почему это важно?", whatConsequences: "Какие могут быть последствия?" },
	pl: { whatSaid: (n) => `Co oświadczył ${n}?`, whatRole: (n) => `Jaką rolę odgrywa ${n}?`, whySignificant: "Dlaczego to jest istotne?", whatConsequences: "Jakie mogą być konsekwencje?" },
	tr: { whatSaid: (n) => `${n} ne açıkladı?`, whatRole: (n) => `${n} hangi rolü oynuyor?`, whySignificant: "Bu neden önemli?", whatConsequences: "Bunun sonuçları ne olabilir?" },
	ja: { whySignificant: "なぜこれが重要なのですか？", whatConsequences: "どのような結果が考えられますか？" },
	ko: { whySignificant: "왜 이것이 중요한가요?", whatConsequences: "어떤 결과가 예상되나요?" },
	zh: { whySignificant: "为什么这很重要？", whatConsequences: "可能会有什么后果？" },
	hi: { whySignificant: "यह क्यों महत्वपूर्ण है?", whatConsequences: "इसके क्या परिणाम हो सकते हैं?" },
	ar: { whySignificant: "لماذا هذا مهم؟", whatConsequences: "ما هي العواقب المحتملة؟" },
	he: { whySignificant: "מדוע זה משמעותי?", whatConsequences: "מהן ההשלכות האפשריות?" },
};

const DE_ABSTRACT_SUFFIX = /(?:schreiben|schaft|ung|keit|heit|nis|tum|ment|tion|sion|ismus|ität|lagen|ungen|äten)$/i;

function generateQuestionsNonEnglish(paragraphs, lang, { returnAll = false } = {}) {
	const T = QUESTION_TEMPLATES[lang];
	if (!T) return returnAll ? { picked: [], allCandidates: [] } : [];
	const X = QUESTION_EXTRAS[lang] || {};

	const total = paragraphs.length;
	const candidates = [];
	const seen = new Set();

	function add(q) {
		if (!q || q.length < 10 || seen.has(q)) return;
		seen.add(q);
		candidates.push(q);
	}

	const TITLE_PREFIXES = /^(?:Dr|Mr|Mrs|Ms|Prof|Sir|Dame|Mme|Mlle|M\.|Herr|Frau|Präsident|Präsidentin|Oberhaupt|Ajatollah|Kanzler|Kanzlerin|Bauherr|Eigentümer|Bürgermeister|Bezirksamtschef|Architekt|Geschäftsführer|Abgeordneter|Abgeordnete|Sprecherin|Sprecher|Amerikaner|Amerikanerin|Deutscher|Deutsche|Républicain|Républicaine|Président|Ministre|Directeur|Maire|Préfet|Professeur|Docteur|Monsieur|Madame)\s+/i;
	const nameRe = /(?:(?:Dr|Mr|Mrs|Ms|Prof|Sir|Dame|Mme|Mlle|M\.|Herr|Frau|Präsident|Präsidentin|Bauherr|Eigentümer|Bürgermeister|Bezirksamtschef|Architekt|Geschäftsführer|Président|Ministre|Directeur|Maire|Préfet|Professeur|Docteur|Monsieur|Madame)\s+)?[A-Z][a-zàâäéèêëïîôùûüçñß]+(?:\s+[A-Z][a-zàâäéèêëïîôùûüçñß]+){1,3}/g;

	const FILLER = /^(Le|La|Les|Un|Une|Des|Der|Die|Das|Ein|Eine|El|Los|Las|Il|Lo|Gli|De|Het|Een|The|This|That|But|And|Or|So|Yet|Also|While|If|After|Before|Since|When|Where|Pour|Dans|Sur|Avec|Mais|Par|Qui|Que|Vom|Auf|Mit|Und|Oder|Nach|Vor|Bei|Von|Für|Per|Con|Del|Sul|Dal|Nel|Tra|Maar|Voor|Met|Van|Naar|Bij|Uit|Over|Zum|Zur|Beim|Über|Unter|Zwischen|Außer|Dont|Où|Selon|Après|Avant|Pendant|Sans|Vers|Entre|Gegen|Durch|Ohne|Trotz|Wegen|Seit|Während|Neubau|Altbau|Weitere|Neue|Alten|Altem|Dieses|Jeder|Jede|Jedes|Positive|Zusätzlich|Lost|Fertig|Name|Krieg|Streit|Umgang|Laut|Neben|Auch|Doch|Noch|Hier|Dort|Jetzt|Dann|Schon|Seine|Seiner|Seinem|Seinen|Ihre|Ihrer|Ihrem|Ihren|Andere|Anderen|Anderem|Verschiedene|Mehrere|Manche|Dessen|Deren|Make|Obwohl|Damit|Daher|Darauf|Darin|Davon|Dabei|Dafür|Dagegen|Weder|Sowohl|Zuletzt|Bereits|Im|Am|Ans|Ins|Aufs|Ums|Zum|Zur|Beim|Vom|Laut|Kein|Keine|Keinem|Keiner|Solche|Solcher|Einige|Alle|Allem|Allen|Aller)\b/;
	const NON_NAMES = /\b(Club|School|College|University|Hospital|Church|Police|Army|Navy|Force|Guard|Park|Street|Avenue|Road|Square|Bridge|Tower|Bank|Station|Airport|National|International|Royal|United|North|South|East|West|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|January|February|March|April|May|June|July|August|September|October|November|December|Straße|Landstraße|Platz|Weg|Kirche|Schule|Markt|Universität|Polizei|Gericht|Rathaus|Bahnhof|Bahnhofs|Flughafen|Bezirksamtschef|Stadtteil|Quartier|Ecke|Vier|Drei|Zwei|Eins|Konzept|Gebäude|Geschosse|Staffelgeschoss|Vollgeschosse|Tiefgarage|Grünflächen|Festsaal|Bauantrag|Stadt|See|Wohnungen|Euro|Dach|Schnäppchen|Preis|Ende|Jahr|Jahren|Grundstück|Projekt|Mehrwert|Planung|Bezirk|Neuigkeiten|Gelände|Restaurant|Stellplätzen|Wohnraum|Gärten|Spielgeräte|Eigentumswohnungen|Kinder|Durchschnittspreis|Kaltmiete|Solaranlagen|Wärmepumpen|Kinderspielfläche|Außenanlagen|Traditionslokal|Place|Rue|Boulevard|Château|Église|Gare|Lycée|Collège|Tribunal|Mairie|Préfecture|Arrondissement|Département|Article|Détenu|Semaines|Cavale|France|Société|Police|Justice|Prison|Garde|Suspect|Enquête|Krieg|Rücktritt|Rücktrittsschreiben|Bewegung|Regierung|Erzählung|Abgeordnete|Mandat|Kongress|Sendung|Bedrohung|Wähler|Anhänger|Zwischenwahlen|Follower|Unterstützer|Mehrheit|Repräsentantenhaus|Senat|Moderator|Podcaster|Rechtsextremist|Worte|Worten|Figuren|Stimmen|Reihen|Mitglied|Mitglieder|Aufständischen|Hardliner|Sprachrohr|Sprachrohre|Kernpunkt|Aussage|Aussagen|Bekanntheit|Kritik|Gegenwind|Gegenrede|Schreiben|Positionen|Verräterin|Verbündete|Verbündeten|Lüge|America|Great|Again|Moment|Zuge|Frage|Fragen|Sache|Sachen|Wahrheit|Seite|Seiten|Beispiel|Grund|Gründe|Meinung|Anfang|Stelle|Punkte|Punkt|Recht|Blick|Wort|Zukunft|Vergangenheit|Geschichte|Beitrag|Beiträge)\b/;

	function isValidName(n) {
		if (n.length < 5 || n.length > 50) return false;
		if (FILLER.test(n)) return false;
		if (NON_NAMES.test(n)) return false;
		const parts = n.split(/\s+/);
		if (parts.length < 2) return false;
		if (lang === "de" && parts.some(p => p.endsWith("s") && /^[A-Z][a-zäöüß]+s$/.test(p) && p.length > 3)) return false;
		if (lang === "de" && parts.some(p => p.length > 11)) return false;
		return true;
	}

	// --- Primary: paragraph-level speech-verb questions from middle/lower content ---
	const speechRe = SPEECH_VERBS_BY_LANG[lang];
	if (speechRe && X.whatSaid) {
		for (let pi = Math.max(2, Math.ceil(total * 0.2)); pi < total; pi++) {
			const para = paragraphs[pi];
			if (para.length < 40 || !speechRe.test(para)) continue;
			const rawNames = [...new Set([...para.matchAll(nameRe)].map(m => m[0].trim()))];
			const names = rawNames.map(n => n.replace(TITLE_PREFIXES, "").trim()).filter(isValidName);
			for (const name of names.slice(0, 1)) {
				const window = para.slice(Math.max(0, para.indexOf(name) - 60), para.indexOf(name) + name.length + 60);
				if (speechRe.test(window)) {
					add(X.whatSaid(name));
					break;
				}
			}
		}
	}

	// --- Secondary: "What role does X play?" from middle/lower paragraphs ---
	if (X.whatRole) {
		for (let pi = Math.max(2, Math.ceil(total * 0.3)); pi < total; pi++) {
			const para = paragraphs[pi];
			if (para.length < 40) continue;
			const rawNames = [...new Set([...para.matchAll(nameRe)].map(m => m[0].trim()))];
			const names = rawNames.map(n => n.replace(TITLE_PREFIXES, "").trim()).filter(isValidName);
			for (const name of names.slice(0, 1)) {
				add(X.whatRole(name));
				break;
			}
			if (candidates.length >= 4) break;
		}
	}

	// --- Broader template questions as fallback ---
	add(T.mainIssue);
	add(T.response);
	add(T.impact);
	add(T.nextSteps);
	if (X.whySignificant) add(X.whySignificant);
	if (X.whatConsequences) add(X.whatConsequences);

	// Pick 2 candidates with different question patterns for variety
	const picked = [];
	const usedPrefixes = new Set();
	for (const q of candidates) {
		const prefix = q.split(/\s/).slice(0, 2).join(" ").toLowerCase();
		if (picked.length > 0 && usedPrefixes.has(prefix)) continue;
		usedPrefixes.add(prefix);
		picked.push(q);
		if (picked.length >= 2) break;
	}
	while (picked.length < 2) {
		picked.push(picked.length === 0 ? T.mainIssue : T.impact);
	}

	if (returnAll) {
		return { picked, allCandidates: candidates };
	}
	return picked;
}

/**
 * Scan individual paragraphs — especially from the middle and lower portions
 * of the article — and generate questions whose answers live in those paragraphs.
 * Returns an array of { q, p (priority), key } objects.
 */
function extractDeepQuestions(paragraphs) {
	const total = paragraphs.length;
	const results = [];
	const seen = new Set();

	const SKIP_SUBJECTS = /^(The|This|That|However|Meanwhile|After|Before|Despite|Also|But|And|It|He|She|They|We|You|In|On|At|As|If|So|Or|Yet|While|Although|Since|Because|When|Where|Until|From|With|About|Between|Through|During|Against|Within|Without|Below|Above|Into|Under|Over)$/;

	const VERB_QUESTION = {
		threatened: (n) => `What threat did ${n} make?`,
		pledged:    (n) => `What did ${n} pledge to do?`,
		vowed:      (n) => `What did ${n} vow to do?`,
		promised:   (n) => `What did ${n} promise?`,
		demanded:   (n) => `What did ${n} demand?`,
		urged:      (n) => `What did ${n} call for?`,
		warned:     (n) => `What did ${n} warn about?`,
		"called for": (n) => `What did ${n} call for?`,
		"called on":  (n) => `What did ${n} call for?`,
	};

	const STOP_WORDS = new Set(["what", "who", "why", "how", "where", "which", "did", "does", "was", "were", "has", "have", "had", "are", "is", "the", "this", "that", "been"]);

	function add(q, priority) {
		if (!q || q.length < 15 || q.length > 120 || !q.endsWith("?")) return;
		const key = q.toLowerCase();
		if (seen.has(key)) return;
		for (const s of seen) {
			const sW = s.split(/\s+/).filter(w => w.length > 3 && !STOP_WORDS.has(w));
			const qW = key.split(/\s+/).filter(w => w.length > 3 && !STOP_WORDS.has(w));
			const ov = sW.filter(w => qW.includes(w));
			if (ov.length >= 2 && ov.length >= Math.min(sW.length, qW.length) * 0.6) return;
		}
		seen.add(key);
		results.push({ q, p: priority, key: `deep-${results.length}` });
	}

	function validSubject(n) {
		return n && n.length > 2 && !SKIP_SUBJECTS.test(n);
	}

	const PLATFORMS = /\b(Truth Social|Twitter|Telegram|Facebook|Instagram|Weibo|TikTok|Substack|Threads|YouTube|Reddit)\b/i;

	function depthOf(pi) {
		return pi < 2 ? 5 : pi < Math.ceil(total * 0.25) ? 4 : pi < Math.ceil(total * 0.5) ? 2 : 1;
	}

	// Pass 1 — most specific: speech + platform, told audience, threatened/pledged
	for (let pi = 0; pi < total; pi++) {
		const para = paragraphs[pi];
		if (para.length < 50) continue;
		const depth = depthOf(pi);

		// Speech + platform ("Trump wrote on … Truth Social")
		if (/\b(wrote|posted|said|tweeted|stated|declared|announced|shared|added)\b/.test(para) && PLATFORMS.test(para)) {
			const nameMatch = para.match(/([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3})\s+(?:wrote|posted|said|tweeted|stated|declared|announced|shared|added)\b/);
			const platform = para.match(PLATFORMS);
			if (nameMatch && platform && validSubject(nameMatch[1])) {
				add(`What did ${nameMatch[1]} say on ${platform[0]}?`, depth);
			}
		}

		// Name told reporters/audience
		const toldRe = /([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3})\s+told\s+(reporters|journalists|the press|Congress|Parliament|lawmakers|the public|a press conference|a news conference|the court|the BBC|CNN|Fox News)/;
		const tlm = para.match(toldRe);
		if (tlm && validSubject(tlm[1])) {
			add(`What did ${tlm[1]} tell ${tlm[2]}?`, depth);
		}

		// Threatened / pledged / vowed / demanded
		const pledgeRe = /([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3})\s+(?:has\s+)?(?:since\s+)?(threatened|pledged|vowed|promised|demanded|urged|warned|called for|called on)\b/;
		const plm = para.match(pledgeRe);
		if (plm && validSubject(plm[1])) {
			const tpl = VERB_QUESTION[plm[2].toLowerCase()];
			if (tpl) add(tpl(plm[1]), depth);
		}
	}

	// Pass 2 — moderately specific: criticism, price changes, attacks
	for (let pi = 0; pi < total; pi++) {
		const para = paragraphs[pi];
		if (para.length < 50) continue;
		const depth = depthOf(pi);

		// Slammed / criticized + target
		const slamRe = /([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3})\s+(?:also\s+)?(slammed|criticized|criticised|condemned|accused|blamed|denounced|lashed out at)\s+(?:(?:the|other|his|her|their|fellow)\s+)?(.{3,35}?)\s+(?:as|for|of|over|by|saying)\b/i;
		const sm = para.match(slamRe);
		if (sm && validSubject(sm[1])) {
			const target = sm[3].replace(/^(the|other|his|her|their)\s+/i, "").trim();
			if (target.length > 2) add(`Why did ${sm[1]} criticize ${target}?`, depth);
		}

		// Price / market changes
		const priceSubject = para.match(/\b(oil|gas|energy|fuel|food|housing|stock|gold|crude|wheat|commodity|gasoline|petrol)\s+(prices?|costs?|rates?)/i);
		if (priceSubject && /\b(rose|rising|surged?|jumped?|climbed?|fell|dropped?|declined?|plunged?|hit|reached?|soared?|spiked?|rallied?|tumbled?|increased?|decreased?)\b/i.test(para)) {
			add(`What happened to ${priceSubject[1].toLowerCase()} prices?`, depth);
		}

		// Target came under attack / was struck
		const atkRe = /([A-Z][a-z]+(?:['\u2019]s?\s+)?[A-Z][A-Za-z-]+(?:\s+[A-Za-z-]+){0,3}?)\s+(?:came under attack|was struck|was hit|was targeted|was attacked|was bombed|was damaged|was destroyed)/;
		const am = para.match(atkRe);
		if (am) {
			add(`What happened to ${am[1].trim()}?`, depth);
		}

		// Consequence / follow-up
		if (/\b(following|after|in the wake of|in response to|as a result of)\b/i.test(para) && pi > 2) {
			const consequenceVerb = para.match(/\b(deployed|launched|imposed|introduced|announced|lifted|suspended|blocked|reversed|expanded)\s+(.{5,40}?)\b/i);
			if (consequenceVerb) {
				add(`What action was taken following recent events?`, depth);
			}
		}
	}

	// Pass 3 — least specific: generic speech attribution ("[quote]" Name said)
	for (let pi = 0; pi < total; pi++) {
		const para = paragraphs[pi];
		if (para.length < 50) continue;
		const afterQuoteRe = /["\u201d\u201c"]\s*,?\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3})\s+(?:said|wrote|told|added|warned|explained|declared|stated|announced)/;
		const aqm = para.match(afterQuoteRe);
		if (aqm && validSubject(aqm[1])) {
			add(`What did ${aqm[1]} say?`, depthOf(pi));
		}
	}

	return results;
}

function generateQuestions(paragraphs, { returnAll = false, lang = "en" } = {}) {
	if (lang !== "en" && QUESTION_TEMPLATES[lang]) {
		return generateQuestionsNonEnglish(paragraphs, lang, { returnAll });
	}

	const sentences = extractSentences(paragraphs);

	// Primary source: paragraph-level questions from middle/lower article content
	const deepQs = extractDeepQuestions(paragraphs);

	const FILLER_STARTS = /^(The|This|That|However|Nevertheless|Meanwhile|Speaking|According|But|And|Or|So|Yet|Also|While|Although|If|After|Before|Since|As|When|Where|Its|Their|Our|His|Her|He|She|It|They|We|You|I|Some|Many|Most|All|Any|Each|Every|One|Two|Three|Four|Five|Six|Seven|Eight|Nine|Ten|More|Less|Such|Other|Another|Both|Few|Several|Outside|Inside|Above|Below|Under|Over|Between|Among|Within|Without|During|Despite|Across|Along|Around|Through|About|Against|Beyond|Until|Towards|Toward)\b/;
	const TITLES = /^(Dr|Mr|Mrs|Ms|Prof|Sir|Dame|Lord|Lady|Cllr|Rev|Sgt|Cpt|Gen|Col|Lt)\b\.?\s*/;

	// Words that appear in place/org names but never in person names
	const NON_PERSON_WORDS = new Set([
		// Institutions & buildings
		"Club", "School", "College", "University", "Hospital", "Church", "Stadium",
		"Street", "Avenue", "Road", "Square", "Park", "Bridge", "Tower", "Gate",
		"Agency", "Council", "Authority", "Board", "Commission", "Committee",
		"Department", "Ministry", "Office", "Bureau", "Foundation", "Trust",
		"Institute", "Centre", "Center", "Academy", "Studios", "Studio", "Museum",
		"House", "Hall", "Palace", "Court", "Castle", "Abbey", "Cathedral",
		"Grammar", "Primary", "Secondary",
		// Government & politics
		"Prime", "Minister", "President", "Chancellor", "Secretary", "Speaker",
		"Senator", "Governor", "Mayor", "Ambassador", "Envoy", "Adviser",
		"Parliament", "Congress", "Senate", "Cabinet", "Downing",
		// Geography
		"County", "City", "Town", "Village", "District", "Region", "State",
		"National", "International", "Royal", "British", "American", "European",
		"Northern", "Southern", "Eastern", "Western", "Central", "United",
		"Islands", "Mountains", "River", "Lake", "Bay", "Coast", "Beach", "Sea",
		"Gulf", "Strait", "Channel", "Peninsula", "Valley", "Desert", "Ocean",
		"New", "Old", "North", "South", "East", "West", "Great", "Little",
		"Europe", "Asia", "Africa", "America", "Australia", "Oceania",
		"Iran", "Iraq", "China", "Russia", "India", "Japan", "Korea",
		"France", "Germany", "Italy", "Spain", "Canada", "Mexico", "Brazil",
		"Britain", "Scotland", "Wales", "Ireland", "England", "Cornwall",
		"London", "Paris", "Berlin", "Rome", "Moscow", "Beijing", "Tokyo",
		"Washington", "Canterbury", "Edinburgh", "Cardiff", "Belfast",
		"Manchester", "Birmingham", "Liverpool", "Glasgow", "Leeds", "Bristol",
		// Military & security
		"Police", "Fire", "Army", "Navy", "Naval", "Force", "Forces", "Guard",
		"Base", "Camp", "Fort", "Station", "Port", "Harbour", "Harbor", "Airport",
		"Nuclear", "Atomic", "Missile", "Submarine", "Disarmament", "Deterrent",
		"Military", "Defence", "Defense", "Security", "Intelligence",
		// Organisations & media
		"Airlines", "Airways", "Rail", "Transport", "Energy", "Media", "Group",
		"Union", "League", "Association", "Federation", "Organisation", "Organization",
		"Bank", "Exchange", "Market", "Trade", "Service", "Services",
		"Health", "Social", "Digital", "Insight", "Analytics", "Solutions",
		"Globe", "Times", "Post", "Telegraph", "Herald", "Star", "Mirror",
		"News", "Daily", "Sunday", "Weekly", "Monthly",
		// Titles & qualifiers
		"Premier", "Super", "Major", "Minor", "General", "Special",
		"High", "Middle", "Lower", "Upper", "Senior", "Junior", "Chief",
		"Queen", "King", "Prince", "Princess", "Duke", "Duchess", "Emperor",
		// Calendar & time
		"Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
		"January", "February", "March", "April", "May", "June", "July",
		"August", "September", "October", "November", "December",
		"Easter", "Christmas", "Ramadan", "Maundy", "Lent",
		// Concepts & adjectives that aren't names
		"Truth", "Freedom", "Liberty", "Justice", "Peace", "Democracy",
		"Regime", "Terrorist", "Extremist", "Rebel", "Militant", "Insurgent",
		"Campaign", "Movement", "Coalition", "Alliance", "Pact", "Treaty",
		"Global", "World", "Modern", "Ancient", "Historic", "Traditional",
	]);

	function isRealName(name) {
		if (!name || name.length < 4 || name.length > 50) return false;
		const hasTitle = TITLES.test(name);
		const clean = name.replace(TITLES, "").trim();
		if (!clean) return false;
		if (FILLER_STARTS.test(clean)) return false;
		const parts = clean.split(/\s+/);
		// Title + single surname (e.g. "Dr Ghosh") is valid
		if (parts.length < (hasTitle ? 1 : 2) || parts.length > 5) return false;
		if (parts.some(p => NON_PERSON_WORDS.has(p))) return false;
		return parts.every(p => /^[A-Z][a-z]+$/.test(p));
	}

	function isRealEntity(name) {
		if (!name || name.length < 3 || name.length > 50) return false;
		const clean = name.replace(TITLES, "");
		if (FILLER_STARTS.test(clean)) return false;
		const parts = clean.split(/\s+/);
		return parts.every(p => /^[A-Z][a-z]+$/.test(p) || /^[A-Z]{2,}$/.test(p));
	}

	// Multi-word or acronym org names only — reject single place names
	function isOrgName(name) {
		if (!isRealEntity(name)) return false;
		const parts = name.split(/\s+/);
		// Acronyms like UKHSA, NHS, LSHTM are org-like
		if (parts.some(p => /^[A-Z]{2,}$/.test(p))) return true;
		// Multi-word names with org-like suffixes
		if (parts.length >= 2) return true;
		return false;
	}

	// Final coherence check — reject anything that doesn't read well
	function isCoherent(q) {
		if (!q || q.length < 20 || q.length > 120) return false;
		// Must start with a question word and end with ?
		if (!/^(Who|What|Why|How|Where|Which)\b/.test(q)) return false;
		if (!q.endsWith("?")) return false;
		// Reject questions with leftover conjunctions / dangling clauses
		if (/,\s*(but|and|or|while|although|as|yet)\s/i.test(q)) return false;
		// Reject if it contains unresolved pronouns as the main subject
		if (/^(Who|What|Why|How)\s+(is|are|was|were|did|does|do|has|have|had)\s+(he|she|it|they|them|this|that)\b/i.test(q)) return false;
		// Reject very generic / low-value questions
		if (/described in this article/i.test(q)) return false;
		return true;
	}

	const candidates = [];

	// Seed with paragraph-level deep questions (highest priority)
	for (const dq of deepQs) {
		candidates.push(dq);
	}

	function add(q, priority, key) {
		if (!isCoherent(q)) return;
		const qLower = q.toLowerCase();
		for (const c of candidates) {
			if (c.q.toLowerCase() === qLower) return;
			const cWords = c.q.toLowerCase().split(/\s+/).filter(w => w.length > 3);
			const qWords = qLower.split(/\s+/).filter(w => w.length > 3);
			const overlap = cWords.filter(w => qWords.includes(w));
			if (overlap.length >= 2 && overlap.length >= Math.min(cWords.length, qWords.length) * 0.5) return;
		}
		candidates.push({ q, p: priority, key });
	}

	// Extract all proper nouns for later use
	const allText = paragraphs.slice(0, 10).join(" ");
	const properNouns = [...new Set(
		(allText.match(/[A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,})*/g) || [])
			.filter(n => isRealEntity(n))
	)];

	// Irregular plurals — nouns that are already plural or don't take "s"
	const ALREADY_PLURAL = new Set(["people", "troops", "police", "staff", "aircraft", "sheep"]);
	function pluralise(noun) {
		if (ALREADY_PLURAL.has(noun) || noun.endsWith("s")) return noun;
		return noun + "s";
	}

	// Reverse past-tense to base form for natural question phrasing
	const PAST_TO_BASE = {
		announced: "announce", confirmed: "confirm", warned: "warn",
		urged: "urge", ordered: "order", approved: "approve", launched: "launch",
		released: "release", published: "publish", issued: "issue",
		recommended: "recommend", requested: "request", proposed: "propose",
		introduced: "introduce", completed: "complete", identified: "identify",
		revealed: "reveal", reported: "report", speculated: "speculate",
		stressed: "stress", added: "add", explained: "explain",
		described: "describe", argued: "argue", stated: "state",
	};

	// Name regex fragment (with optional title prefix)
	const NAME_RE = "(?:(?:Dr|Mr|Mrs|Ms|Prof|Sir|Dame|Lord|Lady|Cllr|Rev)\\.?\\s+)?[A-Z][a-z]+(?:\\s+[A-Z][a-z]+){1,3}";
	const SPEECH_VERBS = "said|announced|revealed|warned|urged|confirmed|argued|explained|stated|described|speculated|stressed|added|called for";

	for (let i = 0; i < sentences.length; i++) {
		const s = sentences[i];
		if (s.length < 40 || s.length > 250) continue;
		if (/^[""\u201c]/.test(s)) continue;

		// --- Why was [Subject] [action] --- (deeper question about events)
		const passiveRe = new RegExp(`(${NAME_RE})\\s+(was|were|has been|have been)\\s+(arrested|charged|killed|injured|suspended|cancelled|banned|blocked|detained|evacuated|rescued|elected|appointed|dismissed|fired|deployed|launched|attacked|bombed|closed|ordered|fined|recalled|rejected|approved|denied|removed|condemned|criticised|criticized)`);
		const passiveMatch = s.match(passiveRe);
		if (passiveMatch && isRealEntity(passiveMatch[1])) {
			add(`Why was ${passiveMatch[1]} ${passiveMatch[3].toLowerCase()}?`, 1, "passive-" + i);
		}

		// --- What did [Person] say --- handles both "X said" and "said X" ---
		const saidBeforeRe = new RegExp(`(${NAME_RE})\\s+(${SPEECH_VERBS})\\b`, "g");
		const saidAfterRe = new RegExp(`(?:${SPEECH_VERBS})\\s+(${NAME_RE})`, "g");
		for (const m of s.matchAll(saidBeforeRe)) {
			if (isRealName(m[1])) add(`What did ${m[1]} say?`, 3, "said-" + m[1]);
		}
		for (const m of s.matchAll(saidAfterRe)) {
			if (isRealName(m[1])) add(`What did ${m[1]} say?`, 3, "said-" + m[1]);
		}

		// --- What role does [Person] play --- for names with descriptive context ---
		const roleRe = new RegExp(`(${NAME_RE}),?\\s+(?:the\\s+|a\\s+|an\\s+)?([a-z].{8,60}?)(?:,|\\.|$)`, "g");
		for (const roleMatch of s.matchAll(roleRe)) {
			if (isRealName(roleMatch[1])) {
				add(`What role does ${roleMatch[1]} play?`, 5, "role-" + roleMatch[1]);
			}
		}

		// --- How many [things] --- simple, always-coherent template ---
		const numMatch = s.match(/\b(\d[\d,]*(?:\.\d+)?)\s+(people|students|cases|patients|deaths|doses|officers|soldiers|troops|workers|members|suspects|victims|flights|schools|hospitals|vaccines|homes|residents|passengers|voters|seats|arrests|infections)\b/i);
		if (numMatch) {
			const noun = numMatch[2].toLowerCase();
			const nounPl = pluralise(noun);
			// Try to find a past participle right after the noun phrase
			const afterNoun = s.slice(s.indexOf(numMatch[0]) + numMatch[0].length);
			const ppMatch = afterNoun.match(/^\s+(?:have |has |had |were |are |was |will be )?(?:\w+\s+)?(?:been\s+)?(?:\w+\s+)?(vaccinated|confirmed|infected|killed|injured|arrested|reported|recorded|deployed|administered|affected|hospitalised|hospitalized|evacuated|rescued|treated|tested|quarantined|identified|admitted|defined|stranded|displaced|detained|suspended|closed|opened)/i);
			if (ppMatch) {
				add(`How many ${nounPl} have been ${ppMatch[1].toLowerCase()}?`, 2, "howmany-" + i);
			} else {
				const entityCtx = properNouns.find(pn => s.includes(pn) && pn.split(/\s+/).length >= 2);
				if (entityCtx) {
					add(`How many ${nounPl} are connected to ${entityCtx}?`, 3, "howmany-" + i);
				}
			}
		}

		// --- Where did [event] happen ---
		const eventNoun = s.match(/\b(outbreak|attack|shooting|bombing|protest|rally|election|trial|crash|fire|flood|earthquake|explosion|incident|strike|raid|arrest|crisis|war|conflict|battle|operation)\b/i);
		const placeMatch = s.match(/\b(?:in|at|near|across)\s+((?:[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2}))\b/);
		if (eventNoun && placeMatch && isRealEntity(placeMatch[1]) && i < sentences.length * 0.6) {
			add(`Where did the ${eventNoun[1].toLowerCase()} take place?`, 3, "where-" + i);
		}

		// --- What is [Entity/concept] --- definitional sentences ---
		if (i > 3) {
			const defMatch = s.match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3})\s+(?:is|are|was|were)\s+(?:a|an|the)\s+([a-z].{10,50}?)(?:\.|,|$)/);
			if (defMatch && isRealEntity(defMatch[1])) {
				add(`What is ${defMatch[1]}?`, 4, "whatis-" + defMatch[1]);
			}
		}

		// --- What did [Organisation] do --- requires multi-word/acronym org ---
		const orgRe = new RegExp(`\\b((?:the\\s+)?(?:[A-Z][A-Za-z]*(?:\\s+[A-Z][A-Za-z]*){0,5}))\\s+(?:has|had|have)?\\s*(announced|confirmed|warned|urged|ordered|approved|launched|released|published|issued|recommended|requested|proposed|introduced|completed|identified|revealed|reported)\\b`);
		const orgMatch = s.match(orgRe);
		if (orgMatch) {
			let org = orgMatch[1].replace(/^the\s+/i, "").trim();
			if (isOrgName(org)) {
				const verb = orgMatch[2].toLowerCase();
				const base = PAST_TO_BASE[verb] || verb;
				if (base === "warn") add(`What did ${org} warn about?`, 2, "org-" + i);
				else if (base === "urge") add(`What did ${org} call for?`, 2, "org-" + i);
				else add(`What did ${org} ${base}?`, 2, "org-" + i);
			}
		}

		// --- What caused / What led to ---
		const causalMatch = s.match(/\b(because of|due to|as a result of|in response to|following|after)\s+(.{10,60}?)(?:\.|,|$)/i);
		if (causalMatch && i < sentences.length * 0.6) {
			const eventNounInS = s.match(/\b(outbreak|attack|crisis|war|conflict|arrest|suspension|closure|ban|cancellation|delay|shortage|strike|protest|collapse|decline|rise|surge|increase|drop|fall|change|decision|move|shift)\b/i);
			if (eventNounInS) {
				add(`What caused the ${eventNounInS[1].toLowerCase()}?`, 2, "caused-" + i);
			}
		}

		// --- What measures / actions were taken ---
		const actionMatch = s.match(/\b(vaccine|vaccination|lockdown|quarantine|curfew|ban|sanction|embargo|deployment|operation|investigation|inquiry|review|assessment|programme|program|package|plan|scheme|strategy|initiative|campaign|effort)\b/i);
		if (actionMatch && /\b(announced|introduced|launched|ordered|imposed|begun|started|set up|established|rolled out|deployed|implemented)\b/i.test(s)) {
			const measure = actionMatch[1].toLowerCase();
			add(`What ${measure} was announced or introduced?`, 3, "measure-" + i);
		}

		// --- What is the current status / situation ---
		if (/\b(so far|to date|as of|currently|at present|at this stage|remains|continues)\b/i.test(s) && i > 2) {
			const topicMatch = s.match(/\b(investigation|outbreak|conflict|crisis|situation|trial|case|operation|search|effort|recovery|response|negotiation)\b/i);
			if (topicMatch) {
				add(`What is the current status of the ${topicMatch[1].toLowerCase()}?`, 4, "status-" + i);
			}
		}

		// --- What warning / concern was raised ---
		if (/\b(warned|cautioned|feared|concerned|worried|raised concerns|raised alarm|flagged|highlighted)\b/i.test(s)) {
			const nameInS = s.match(new RegExp(NAME_RE));
			if (nameInS && isRealName(nameInS[0])) {
				add(`What warning did ${nameInS[0]} give?`, 3, "warn-" + i);
			} else {
				add(`What concerns have been raised?`, 4, "concern-" + i);
			}
		}
	}

	// ── Broader candidate generation from the full text ──

	const fullText = paragraphs.slice(0, 15).join(" ");

	// Add "What role does [name] play?" for prominent names not already covered
	const nameRe = new RegExp(NAME_RE, "g");
	const allNames = [...new Set(
		[...fullText.matchAll(nameRe)].map(m => m[0].trim()).filter(isRealName)
	)];
	for (const name of allNames.slice(0, 4)) {
		add(`What role does ${name} play?`, 6, "role-scan-" + name);
	}

	// Add "What happened in [Place]?" for key locations
	const locationRe = /\b(?:in|at|near|across)\s+((?:[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2}))\b/g;
	const seenPlaces = new Set();
	for (const m of fullText.matchAll(locationRe)) {
		const place = m[1].trim();
		if (seenPlaces.has(place) || !isRealEntity(place)) continue;
		// Skip if any word in the place name is a known non-entity word
		if (place.split(/\s+/).some(w => NON_PERSON_WORDS.has(w))) continue;
		seenPlaces.add(place);
		add(`What happened in ${place}?`, 4, "place-" + place);
	}

	// Add topic questions from the article's dominant themes
	const topicCounts = {};
	const topicRe = /\b(meningitis|vaccine|vaccination|war|conflict|attack|arrest|submarine|defence|defense|election|sanctions|tariffs|trade|economy|recession|inflation|climate|protest|strike|refugee|migration|housing|terrorism|pandemic|outbreak|crisis|ceasefire|negotiation|missile|drone|casualties|hostage|prisoner|deportation|asylum|corruption|fraud|trial|verdict|murder|kidnapping|assault|robbery|flood|wildfire|hurricane|tornado|tsunami|investigation|operation|deployment|occupation|invasion|siege|blockade|embargo|summit|treaty|referendum|inquiry|inquest)\b/ig;
	for (const m of fullText.matchAll(topicRe)) {
		const t = m[1].toLowerCase();
		topicCounts[t] = (topicCounts[t] || 0) + 1;
	}
	const topTopics = Object.entries(topicCounts)
		.sort((a, b) => b[1] - a[1])
		.slice(0, 3)
		.map(([t]) => t);
	for (const topic of topTopics) {
		add(`What are the key facts about the ${topic}?`, 5, "topic-" + topic);
	}

	// ── Ensure at least 5 candidates ──
	// Broad but coherent questions derived from the article's content
	if (candidates.length < 5) {
		add("What is the main issue discussed in this article?", 6, "broad-main");
	}
	if (candidates.length < 5) {
		add("What response has been taken by authorities?", 6, "broad-response");
	}
	if (candidates.length < 5) {
		add("What impact could this have going forward?", 6, "broad-impact");
	}
	if (candidates.length < 5) {
		add("What are the next steps or expected developments?", 6, "broad-next");
	}
	if (candidates.length < 5) {
		add("Why is this significant?", 6, "broad-significant");
	}

	// Sort by priority then pick 2 with different question types
	candidates.sort((a, b) => a.p - b.p);
	const picked = [];
	const usedTypes = new Set();
	for (const c of candidates) {
		const type = c.q.split(/\s/)[0].toLowerCase();
		if (usedTypes.has(type) && picked.length < 2) continue;
		usedTypes.add(type);
		picked.push(c.q);
		if (picked.length >= 2) break;
	}

	if (picked.length < 2) {
		for (const c of candidates) {
			if (picked.includes(c.q)) continue;
			picked.push(c.q);
			if (picked.length >= 2) break;
		}
	}

	while (picked.length < 2) {
		picked.push(picked.length === 0
			? "What is the key development reported in this article?"
			: "What impact could this have going forward?");
	}

	if (returnAll) {
		const allQs = candidates.map(c => c.q);
		return { picked, allCandidates: [...new Set(allQs)] };
	}
	return picked;
}

/**
 * @param {{ url: string; outputPath: string; waitUntil: string; timeout: number; publication: string; widgetOptions?: object }} opts
 */
export async function capturePageToPng(opts) {
	const {
		url,
		outputPath,
		waitUntil,
		timeout,
		publication,
		cssSelector = "",
		widgetOptions = {},
		device = "desktop",
	} = opts;

	const href = assertHttpUrl(url);

	const launchOpts = {
		headless: "new",
		timeout: 60_000,
		protocolTimeout: 90_000,
		args: [
			"--no-sandbox",
			"--disable-setuid-sandbox",
			"--disable-dev-shm-usage",
			"--disable-gpu",
			"--no-first-run",
			"--no-zygote",
			"--disable-extensions",
			"--disable-blink-features=AutomationControlled",
		],
	};
	if (process.env.PUPPETEER_EXECUTABLE_PATH) {
		launchOpts.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
	}

	let browser;
	try {
		browser = await puppeteer.launch(launchOpts);
	} catch (err) {
		throw new Error(`Chrome failed to start: ${err.message}`);
	}

	try {
		const page = await browser.newPage();
		const viewport = VIEWPORT_PRESETS[device] || VIEWPORT_PRESETS.desktop;
		await page.setViewport(viewport);

		// ── Stealth: hide headless Chrome signals ──
		await page.evaluateOnNewDocument(() => {
			// Remove the webdriver flag that bot detectors check
			Object.defineProperty(navigator, "webdriver", { get: () => false });

			// Fake a normal Chrome plugin array
			Object.defineProperty(navigator, "plugins", {
				get: () => [
					{ name: "Chrome PDF Plugin", filename: "internal-pdf-viewer" },
					{ name: "Chrome PDF Viewer", filename: "mhjfbmdgcfjbbpaeojofohoefgiehjai" },
					{ name: "Native Client", filename: "internal-nacl-plugin" },
				],
			});

			// Fake language array
			Object.defineProperty(navigator, "languages", {
				get: () => ["en-GB", "en-US", "en"],
			});

			// Pass the chrome.runtime check
			window.chrome = { runtime: {}, csi: () => {}, loadTimes: () => {} };

			// Override permissions query to avoid "denied" on notifications
			const origQuery = window.Permissions?.prototype?.query;
			if (origQuery) {
				window.Permissions.prototype.query = (params) =>
					params.name === "notifications"
						? Promise.resolve({ state: Notification.permission })
						: origQuery.call(this, params);
			}
		});

		// Set a real-looking User-Agent
		if (device === "mobile") {
			await page.setUserAgent(MOBILE_UA);
		} else {
			const defaultUA = await browser.userAgent();
			await page.setUserAgent(defaultUA.replace(/HeadlessChrome/g, "Chrome"));
		}

		await page.goto(href, { waitUntil, timeout });
		await waitUntilCmpResolvedAndSettled(page);

		// Extract publisher brand name from page metadata
		const siteName = await page.evaluate(() => {
			const ogSiteName = document.querySelector('meta[property="og:site_name"]');
			if (ogSiteName?.content?.trim()) return ogSiteName.content.trim();

			const schemaPublisher = document.querySelector('[itemprop="publisher"] [itemprop="name"]');
			if (schemaPublisher?.content?.trim()) return schemaPublisher.content.trim();

			const schemaOrg = document.querySelector('script[type="application/ld+json"]');
			if (schemaOrg) {
				try {
					const data = JSON.parse(schemaOrg.textContent);
					const items = Array.isArray(data) ? data : [data];
					for (const item of items) {
						const pub = item.publisher?.name || item.sourceOrganization?.name;
						if (pub) return pub;
					}
				} catch {}
			}

			const hostname = location.hostname.replace(/^www\./, "");
			const parts = hostname.split(".");
			const domain = parts.length > 1 ? parts[parts.length - 2] : parts[0];
			return domain.charAt(0).toUpperCase() + domain.slice(1);
		});

		// Detect the page language from metadata
		const pageLang = await page.evaluate(() => {
			const htmlLang = document.documentElement.lang;
			if (htmlLang) return htmlLang.split("-")[0].toLowerCase();
			const ogLocale = document.querySelector('meta[property="og:locale"]');
			if (ogLocale?.content) return ogLocale.content.split("_")[0].toLowerCase();
			const metaLang = document.querySelector('meta[http-equiv="content-language"]');
			if (metaLang?.content) return metaLang.content.split("-")[0].toLowerCase();
			return "en";
		});

		// Extract article content for summary and suggested questions
		const articleContent = await page.evaluate(() => {
			const NON_BODY = [
				"figure", "figcaption", "aside", "footer", "nav",
				"blockquote", "form", "table",
				'[class*="caption"]', '[class*="credit"]',
				'[class*="byline"]', '[class*="author"]',
				'[class*="tag"]', '[class*="related"]',
				'[class*="comment"]', '[class*="share"]',
				'[class*="newsletter"]', '[class*="signup"]',
				'[class*="header"]', '[class*="dek"]',
				'[class*="standfirst"]', '[class*="subtitle"]',
				'[class*="summary"]', '[class*="excerpt"]',
				'[class*="teaser"]', '[class*="promo"]',
				'[class*="meta"]', '[class*="timestamp"]',
			].join(", ");

			const paraSelectors = [
				'article [itemprop="articleBody"] p',
				'[itemprop="articleBody"] p',
				"article .article-body p",
				"article .post-content p",
				"article .entry-content p",
				"article p",
				'[role="article"] p',
				".article-body p",
				".post-content p",
				".entry-content p",
				"#mw-content-text p",
				"main p",
			];

			const bodyParagraphs = [];
			const seen = new Set();
			for (const sel of paraSelectors) {
				for (const el of document.querySelectorAll(sel)) {
					if (seen.has(el)) continue;
					seen.add(el);
					const st = window.getComputedStyle(el);
					if (st.display === "none" || st.visibility === "hidden") continue;
					const r = el.getBoundingClientRect();
					if (r.height < 10 || r.width < 100) continue;
					const text = (el.textContent || "").trim();
					if (text.length < 40) continue;
					const blocker = el.closest(NON_BODY);
					if (blocker && blocker !== document.body && blocker !== document.documentElement) continue;
					bodyParagraphs.push(text);
				}
			}

			const headline = (() => {
				const h1 = document.querySelector("article h1, [itemprop='headline'], main h1, h1");
				return h1 ? (h1.textContent || "").trim() : "";
			})();

			return { bodyParagraphs, headline };
		});

		let summary = widgetOptions.summary;
		if (!summary && articleContent.bodyParagraphs.length > 0) {
			summary = buildSummary(articleContent.bodyParagraphs, articleContent.headline, pageLang);
		}

		// Generate 2 questions that are answered within the article
		const generatedQs = generateQuestions(articleContent.bodyParagraphs, { returnAll: true, lang: pageLang });
		const question1 = widgetOptions.question1 || generatedQs.picked[0];
		const question2 = widgetOptions.question2 || generatedQs.picked[1];
		const allCandidateQuestions = generatedQs.allCandidates || [];

		const pubName = siteName || publication;
		const i18n = getWidgetStrings(pageLang, pubName);

		const widgetHtml = buildWidgetMarkup({
			publication: pubName,
			summary,
			question1,
			question2,
			title: i18n.title,
			readMore: i18n.readMore,
			interestsLabel: i18n.interestsLabel,
			askPlaceholder: i18n.askPlaceholder,
			interestQuestion: i18n.interestQuestion,
			...widgetOptions,
		});

	const placement = await page.evaluate((html, selectorOverride) => {
		const existing = document.querySelector("[data-deeperdive-mock]");
		if (existing) existing.remove();

		const tpl = document.createElement("template");
		tpl.innerHTML = html.trim();
		const node = tpl.content.firstElementChild;
		if (!node) return { ok: false, reason: "parse" };

		// If a CSS selector override was provided, insert above that element
		if (selectorOverride) {
			try {
				const target = document.querySelector(selectorOverride);
				if (target) {
					target.insertAdjacentElement("beforebegin", node);
					return { ok: true, placement: "before-selector", selector: selectorOverride };
				}
			} catch (e) {
				return { ok: false, reason: "invalid-selector", selector: selectorOverride, message: e.message };
			}
			return { ok: false, reason: "selector-not-found", selector: selectorOverride };
		}

		const paraSelectors = [
			'article [itemprop="articleBody"] p',
			'[itemprop="articleBody"] p',
			"article .article-body p",
			"article .post-content p",
			"article .entry-content p",
			"article p",
			'[role="article"] p',
			".article-body p",
			".post-content p",
			".entry-content p",
			"#mw-content-text p",
			"main p",
		];

		const NON_BODY_CONTAINERS = [
			"figure", "figcaption", "aside", "footer", "nav",
			"blockquote", "form", "table",
			'[class*="caption"]', '[class*="credit"]',
			'[class*="byline"]', '[class*="author"]',
			'[class*="tag"]', '[class*="related"]',
			'[class*="comment"]', '[class*="share"]',
			'[class*="newsletter"]', '[class*="signup"]',
			'[class*="header"]', '[class*="dek"]',
			'[class*="headline"]', '[class*="subheadline"]',
			'[class*="standfirst"]', '[class*="subtitle"]',
			'[class*="summary"]', '[class*="excerpt"]',
			'[class*="teaser"]', '[class*="promo"]',
			'[class*="meta"]', '[class*="timestamp"]',
		].join(", ");

		// Determine the h1 bottom so we never place the widget above the headline
		const h1El = document.querySelector("h1");
		const h1Bottom = h1El ? h1El.getBoundingClientRect().bottom : 0;

		// Find the hero media (image or video) — the FIRST large media
		// element after the headline. This ensures we skip past the hero
		// but don't get pushed down by later content images.
		let heroBottom = 0;
		const heroMediaCandidates = [];

		// Collect candidate hero images/figures
		const imageSelectors = [
			"article figure", "main figure", "[itemprop='image']",
			"article picture", "main picture",
		];
		for (const sel of imageSelectors) {
			try {
				const el = document.querySelector(sel);
				if (!el) continue;
				const r = el.getBoundingClientRect();
				if (r.width > 200 && r.height > 100) {
					heroMediaCandidates.push({ top: r.top, bottom: r.bottom });
				}
			} catch {}
		}

		// Collect candidate hero videos (native <video>, iframes, and
		// any large element with "video" or "player" in its class)
		for (const sel of ["article video", "main video", "video", '[data-component="video"]', 'iframe[src*="video"]', 'iframe[src*="youtube"]']) {
			try {
				const el = document.querySelector(sel);
				if (!el) continue;
				const r = el.getBoundingClientRect();
				if (r.width > 200 && r.height > 100) {
					heroMediaCandidates.push({ top: r.top, bottom: r.bottom });
				}
			} catch {}
		}
		for (const el of document.querySelectorAll('[class*="video"], [class*="player"]')) {
			try {
				const r = el.getBoundingClientRect();
				if (r.width > 300 && r.height > 150) {
					heroMediaCandidates.push({ top: r.top, bottom: r.bottom });
				}
			} catch {}
		}

		// The hero is the first large media element after the headline
		if (heroMediaCandidates.length > 0) {
			heroMediaCandidates.sort((a, b) => a.top - b.top);
			heroBottom = heroMediaCandidates[0].bottom;
		}

		const contentTop = Math.max(h1Bottom, heroBottom);

		function isBodyParagraph(el) {
			const st = window.getComputedStyle(el);
			if (st.display === "none" || st.visibility === "hidden") return false;
			const r = el.getBoundingClientRect();
			if (r.height < 10 || r.width < 100) return false;
			if (r.top < contentTop) return false;
			if ((el.textContent || "").trim().length < 50) return false;
			const blocker = el.closest(NON_BODY_CONTAINERS);
			if (blocker && blocker !== document.body && blocker !== document.documentElement) return false;
			if (el.closest("h1, h2, h3, h4, h5, h6")) return false;
			return true;
		}

		// Find the first visible body-text paragraph
		let firstPara = null;
		for (const sel of paraSelectors) {
			const els = document.querySelectorAll(sel);
			for (const el of els) {
				if (!isBodyParagraph(el)) continue;
				firstPara = el;
				break;
			}
			if (firstPara) break;
		}

		if (firstPara) {
			firstPara.insertAdjacentElement("beforebegin", node);
			return { ok: true, placement: "before-first-paragraph" };
		}

		const main =
			document.querySelector("article") ||
			document.querySelector("main") ||
			document.querySelector('[role="main"]') ||
			document.body;
		main.insertBefore(node, main.firstChild);
		return { ok: true, placement: "fallback-top-of-article" };
	}, widgetHtml, cssSelector || "");

		if (!placement?.ok) {
			if (placement?.reason === "invalid-selector") {
				throw new Error(`Invalid CSS selector "${placement.selector}": ${placement.message}`);
			}
			if (placement?.reason === "selector-not-found") {
				throw new Error(`No element matched the selector "${placement.selector}" on this page`);
			}
			throw new Error("Failed to parse widget markup");
		}

		// ── Universal page cleanup ──
		// Run BEFORE width/font measurement so measurements reflect the
		// final layout (sidebars removed, columns expanded).
		await page.evaluate(() => {
			const W = "[data-deeperdive-mock]";
			function safe(el) {
				return el.closest(W) || el.querySelector?.(W);
			}
			function hide(selectors) {
				for (const sel of selectors) {
					try {
						for (const el of document.querySelectorAll(sel)) {
							if (safe(el)) continue;
							el.style.setProperty("display", "none", "important");
						}
					} catch { /* invalid selector on this page */ }
				}
			}

			// ── 1. Ads (class, id, data-attr, iframes) ──
			hide([
				'[class*="advertisement"]', '[class*="ad-slot"]',
				'[class*="ad-unit"]',       '[class*="ad-wrapper"]',
				'[class*="ad-container"]',  '[class*="ad-holder"]',
				'[class*="ad-placeholder"]','[class*="ad-break"]',
				'[class*="advert-"]',       '[class*="advert_"]',
				'[class*="inline-ad"]',     '[class*="mid-article"]',
				'[class*="dfp-"]',          '[class*="gpt-ad"]',
				'[class*="google-ad"]',     '[class*="sponsor"]',
				'[id*="google_ads"]',       '[id*="div-gpt-ad"]',
				'[id*="taboola"]',          '[id*="outbrain"]',
				'[id*="ad-slot"]',          '[id*="ad-unit"]',
				'[data-ad]',               '[data-ad-slot]',
				'[data-ad-unit]',          '[data-google-query-id]',
				'iframe[src*="doubleclick"]',
				'iframe[src*="googlesyndication"]',
				'iframe[src*="amazon-adsystem"]',
			]);

			// ── 2. Sidebars ──
			const vw = window.innerWidth;
			const sidebarSels = [
				'[class*="sidebar"]',  '[class*="side-bar"]',
				'[class*="Sidebar"]',  '[class*="SideBar"]',
				'[class*="right-rail"]','[class*="left-rail"]',
				'[class*="rightRail"]', '[class*="right_rail"]',
				'[class*="side-column"]','[class*="aside-column"]',
				'[id*="sidebar"]',     '[id*="side-bar"]',
				'[id*="right-rail"]',  '[id*="left-rail"]',
				'[role="complementary"]',
			];
			for (const sel of sidebarSels) {
				try {
					for (const el of document.querySelectorAll(sel)) {
						if (safe(el)) continue;
						if (el.getBoundingClientRect().width > vw * 0.5) continue;
						el.style.setProperty("display", "none", "important");
					}
				} catch {}
			}
			for (const aside of document.querySelectorAll("aside")) {
				if (safe(aside)) continue;
				if (aside.getBoundingClientRect().width > vw * 0.5) continue;
				aside.style.setProperty("display", "none", "important");
			}

			// ── 2b. After hiding sidebars, expand the main content column ──
			for (const el of document.querySelectorAll(
				'[class*="main--column"], [class*="main-column"], [class*="content-column"], ' +
				'[class*="article-column"], [class*="center-column"], [class*="col-center"], ' +
				'[class*="rm-col-center"], [class*="primary-column"], [class*="content-area"]'
			)) {
				el.style.setProperty("width", "100%", "important");
				el.style.setProperty("max-width", "100%", "important");
				el.style.setProperty("flex", "1 1 100%", "important");
			}

			// ── 3. Related / recommended / recirc / trending ──
			hide([
				'[class*="related-article"]','[class*="related_article"]',
				'[class*="relatedArticle"]', '[class*="RelatedArticle"]',
				'[class*="recommended"]',    '[class*="recirc"]',
				'[class*="more-stories"]',   '[class*="more-from"]',
				'[class*="trending"]',       '[class*="most-read"]',
				'[class*="popular-"]',       '[class*="also-read"]',
				'[class*="you-may-like"]',   '[class*="around-the-web"]',
				'[data-testid*="related"]',  '[data-component*="related"]',
			]);

			// ── 4. Social share bars, newsletter, comments ──
			hide([
				'[class*="share-bar"]',     '[class*="social-share"]',
				'[class*="sharing-"]',      '[class*="share-tools"]',
				'[class*="newsletter"]',    '[class*="subscribe-"]',
				'[class*="signup-"]',       '[class*="sign-up-"]',
				'[class*="comment-section"]','#comments', '#disqus_thread',
			]);

			// ── 5. Collapse empty spacer divs (unfilled ad slots) ──
			for (const el of document.querySelectorAll("div, section")) {
				if (safe(el)) continue;
				if (el.closest("figure, picture")) continue;
				const r = el.getBoundingClientRect();
				if (r.height < 30 || r.height > 800 || r.width < 200) continue;
				const text = (el.textContent || "").replace(/\s+/g, " ").trim();
				if (text.length > 30) continue;
				if (el.querySelector("img[src], img[data-src], video, canvas, svg, picture")) continue;
				if (el.querySelector("p, h1, h2, h3, h4, h5, h6")) continue;
				el.style.setProperty("display", "none", "important");
			}

			// ── 5b. Hide "ADVERTISEMENT" labels and their wrappers ──
			for (const el of document.querySelectorAll("div, span, p, label")) {
				if (safe(el)) continue;
				const text = (el.textContent || "").trim();
				if (/^(advertisement|ad|sponsored|anzeige)$/i.test(text)) {
					el.style.setProperty("display", "none", "important");
					if (el.parentElement && el.parentElement !== document.body) {
						const pt = (el.parentElement.textContent || "").trim();
						if (pt === text) {
							el.parentElement.style.setProperty("display", "none", "important");
						}
					}
				}
			}

			// ── 6. Convert fixed/sticky nav bars to static ──
			for (const el of document.querySelectorAll("nav, header, [class*='nav-'], [class*='navbar'], [class*='masthead']")) {
				const st = window.getComputedStyle(el);
				if (st.position === "fixed" || st.position === "sticky") {
					el.style.setProperty("position", "static", "important");
				}
			}
		});

		await page.evaluate(() => {
		const widget = document.querySelector("[data-deeperdive-mock]");
		if (!widget) return;

		const selectors = [
			'article [itemprop="articleBody"] p',
			'[itemprop="articleBody"] p',
			"article .article-body p",
			"article .post-content p",
			"article .entry-content p",
			"article p",
			'[role="article"] p',
			".article-body p",
			".post-content p",
			".entry-content p",
			"#mw-content-text p",
			"main p",
		];

		const NON_BODY_CONTAINERS = [
			"figure", "figcaption", "aside", "footer", "nav",
			"blockquote", "form", "table",
			'[class*="caption"]', '[class*="credit"]',
			'[class*="byline"]', '[class*="author"]',
			'[class*="tag"]', '[class*="related"]',
			'[class*="comment"]', '[class*="share"]',
			'[class*="newsletter"]', '[class*="signup"]',
			'[class*="header"]', '[class*="dek"]',
			'[class*="headline"]', '[class*="subheadline"]',
			'[class*="standfirst"]', '[class*="subtitle"]',
			'[class*="summary"]', '[class*="excerpt"]',
			'[class*="teaser"]', '[class*="promo"]',
			'[class*="meta"]', '[class*="timestamp"]',
		].join(", ");

		// Collect all visible body-text paragraphs (skip captions,
		// bylines, credits, headers, asides, figures, etc.)
		let fontRef = null;
		const widthBuckets = {};

		for (const sel of selectors) {
			try {
				for (const el of document.querySelectorAll(sel)) {
					if (el.closest("[data-deeperdive-mock]")) continue;
					const st = window.getComputedStyle(el);
					if (st.display === "none" || st.visibility === "hidden") continue;
					const r = el.getBoundingClientRect();
					if (r.height < 10 || r.width < 100) continue;
					if ((el.textContent || "").trim().length < 50) continue;
					const blocker = el.closest(NON_BODY_CONTAINERS);
					if (blocker && blocker !== document.body && blocker !== document.documentElement) continue;

					if (!fontRef) fontRef = el;

					// Bucket widths (rounded to 10px) to find the
					// most common body-text column width
					const bucket = Math.round(r.width / 10) * 10;
					if (!widthBuckets[bucket]) widthBuckets[bucket] = { count: 0, width: r.width, el };
					widthBuckets[bucket].count++;
				}
			} catch {}
		}

		// The body-text column is the most common width
		let widestEl = null;
		let bestCount = 0;
		for (const b of Object.values(widthBuckets)) {
			if (b.count > bestCount) { bestCount = b.count; widestEl = b.el; }
		}

		const ref = fontRef || widestEl;
		if (!ref) return;

		const st = window.getComputedStyle(ref);
		const family = st.fontFamily;
		const size = st.fontSize;
		const textColor = st.color;
		const basePx = Number.parseFloat(size);

		const rules = [];
		const titlePx = basePx ? (basePx * 1.15).toFixed(1) : null;

		const contentSelectors = [
			".dd-mock-title",
			".dd-mock-summary",
			".dd-mock-link-row",
			".dd-mock-link-text",
			".dd-mock-interests-label",
			".dd-mock-chevron",
		];

		if (family) {
			for (const sel of contentSelectors) {
				rules.push(`${sel} { font-family: ${family} !important; }`);
			}
		}
		if (basePx >= 8 && basePx <= 40) {
			rules.push(`.dd-mock-title { font-size: ${titlePx}px !important; }`);
			for (const sel of contentSelectors.filter(s => s !== ".dd-mock-title")) {
				rules.push(`${sel} { font-size: ${basePx}px !important; }`);
			}
		}

		// Match the article body text color so the widget is legible
		// on both light and dark backgrounds
		function parseParts(c) {
			const m = (c || "").match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
			return m ? [+m[1], +m[2], +m[3]] : null;
		}
		if (textColor) {
			for (const sel of contentSelectors) {
				rules.push(`${sel} { color: ${textColor} !important; }`);
			}
			rules.push(`.dd-mock-brand { color: ${textColor} !important; }`);
			rules.push(`.dd-mock-bar-placeholder { color: ${textColor} !important; opacity: 0.55; }`);
			rules.push(`.dd-mock-info { color: ${textColor} !important; border-color: ${textColor} !important; opacity: 0.5; }`);

			const rgb = parseParts(textColor);
			const isDarkText = rgb ? (rgb[0] * 0.299 + rgb[1] * 0.587 + rgb[2] * 0.114) < 140 : true;
			const borderAlpha = isDarkText ? 0.15 : 0.25;
			const dividerColor = rgb
				? `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${borderAlpha})`
				: (isDarkText ? "#eeeeee" : "rgba(255,255,255,0.15)");
			rules.push(`.dd-mock-divider { background: ${dividerColor} !important; }`);
			rules.push(`.dd-mock-bar { border-color: ${dividerColor} !important; }`);
			rules.push(`.dd-mock-bar-sep { background: ${dividerColor} !important; }`);
			rules.push(`.dd-mock-link-row:hover { background: transparent !important; }`);
		}

		// Constrain widget width to the widest body text paragraph
		const bodyWidth = widestEl ? widestEl.getBoundingClientRect().width : 0;
		if (bodyWidth >= 200) {
			rules.push(`.dd-mock-root { max-width: ${Math.round(bodyWidth)}px !important; }`);
		}

		// Match the article body background color
		let bgColor = null;
		let el = ref;
		while (el && el !== document.documentElement) {
			const bg = window.getComputedStyle(el).backgroundColor;
			if (bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent") {
				bgColor = bg;
				break;
			}
			el = el.parentElement;
		}
		if (bgColor) {
			rules.push(`.dd-mock-card { background: ${bgColor} !important; }`);
			rules.push(`.dd-mock-bar { background: ${bgColor} !important; }`);
			const bgRgb = parseParts(bgColor);
			const fadeStart = bgRgb ? `rgba(${bgRgb[0]}, ${bgRgb[1]}, ${bgRgb[2]}, 0)` : "rgba(255,255,255,0)";
			rules.push(`.dd-mock-summary::after { background: linear-gradient(to right, ${fadeStart}, ${bgColor} 65%) !important; }`);
		}

		if (rules.length > 0) {
			const style = document.createElement("style");
			style.textContent = rules.join("\n");
			widget.prepend(style);
		}
	});

		// ── Extract publisher brand color from logo ──
		await page.evaluate(() => {
			const widget = document.querySelector("[data-deeperdive-mock]");
			if (!widget) return;

			function parseColor(str) {
				if (!str) return null;
				str = str.trim();
				const hexMatch = str.match(/^#([0-9a-f]{3,8})$/i);
				if (hexMatch) {
					let hex = hexMatch[1];
					if (hex.length === 3) hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];
					return [parseInt(hex.slice(0,2),16), parseInt(hex.slice(2,4),16), parseInt(hex.slice(4,6),16)];
				}
				const rgbMatch = str.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
				if (rgbMatch) return [+rgbMatch[1], +rgbMatch[2], +rgbMatch[3]];
				return null;
			}

			function isViable(r,g,b) {
				const max = Math.max(r,g,b), min = Math.min(r,g,b);
				if (min > 210) return false; // near-white
				if (max < 40) return false;  // near-black
				if (max - min < 25) return false; // gray / low saturation
				// Filter out default browser link blue
				if (r === 0 && g === 0 && b >= 230 && b <= 255) return false;
				return true;
			}

			function firstViableBg(el) {
				while (el && el !== document.documentElement) {
					const bg = window.getComputedStyle(el).backgroundColor;
					const c = parseColor(bg);
					if (c && isViable(...c)) return c;
					el = el.parentElement;
				}
				return null;
			}

			function applyBrandColor(color) {
				const s = widget.querySelector("style") || document.createElement("style");
				s.textContent += `\n.dd-mock-readmore { background: ${color} !important; }`;
				s.textContent += `\n.dd-mock-submit { background: ${color} !important; }`;
				if (!s.parentElement) widget.prepend(s);
			}

			// 1. <meta name="theme-color">
			const meta = document.querySelector('meta[name="theme-color"]');
			if (meta) {
				const c = parseColor(meta.getAttribute("content"));
				if (c && isViable(...c)) {
					applyBrandColor(`rgb(${c[0]},${c[1]},${c[2]})`);
					return;
				}
			}

			// 2. Logo image — extract dominant color via canvas
			const logoImgSelectors = [
				'header [class*="logo"] img', 'nav [class*="logo"] img',
				'[class*="logo"] img', '[id*="logo"] img',
				'header a > img', 'a[class*="logo"] img', 'a[href="/"] img',
				'header img[alt*="logo" i]', 'img[class*="logo"]', 'img[id*="logo"]',
			];
			let logoImg = null;
			for (const sel of logoImgSelectors) {
				try {
					const el = document.querySelector(sel);
					if (el && el.naturalWidth > 0 && el.complete) { logoImg = el; break; }
				} catch {}
			}
			if (logoImg) {
				try {
					const canvas = document.createElement("canvas");
					const size = 64;
					canvas.width = size; canvas.height = size;
					const ctx = canvas.getContext("2d");
					ctx.drawImage(logoImg, 0, 0, size, size);
					const data = ctx.getImageData(0, 0, size, size).data;
					const buckets = {};
					for (let i = 0; i < data.length; i += 4) {
						const r = data[i], g = data[i+1], b = data[i+2], a = data[i+3];
						if (a < 128) continue;
						if (!isViable(r,g,b)) continue;
						const qr = (r >> 4) << 4, qg = (g >> 4) << 4, qb = (b >> 4) << 4;
						const key = `${qr},${qg},${qb}`;
						buckets[key] = (buckets[key] || 0) + 1;
					}
					let best = null, bestCount = 0;
					for (const [key, count] of Object.entries(buckets)) {
						if (count > bestCount) { bestCount = count; best = key; }
					}
					if (best && bestCount >= 5) {
						applyBrandColor(`rgb(${best})`);
						return;
					}
				} catch {}
			}

			// 3. SVG logo — check fill attributes, then background behind it
			const svgSelectors = [
				'header [class*="logo"] svg', 'nav [class*="logo"] svg',
				'[class*="logo"] svg', 'a[href="/"] svg',
			];
			for (const sel of svgSelectors) {
				try {
					const svg = document.querySelector(sel);
					if (!svg) continue;
					for (const f of svg.querySelectorAll("[fill]")) {
						const c = parseColor(f.getAttribute("fill"));
						if (c && isViable(...c)) {
							applyBrandColor(`rgb(${c[0]},${c[1]},${c[2]})`);
							return;
						}
					}
					// SVG is white/transparent — the brand color is the background behind it
					const bg = firstViableBg(svg);
					if (bg) {
						applyBrandColor(`rgb(${bg[0]},${bg[1]},${bg[2]})`);
						return;
					}
				} catch {}
			}

			// 4. Header/nav background color
			for (const sel of ["header", "nav", '[class*="masthead"]', '[class*="subnav"]', '[class*="topbar"]']) {
				try {
					const el = document.querySelector(sel);
					if (!el) continue;
					const c = parseColor(window.getComputedStyle(el).backgroundColor);
					if (c && isViable(...c)) {
						applyBrandColor(`rgb(${c[0]},${c[1]},${c[2]})`);
						return;
					}
				} catch {}
			}

			// 5. Favicon / apple-touch-icon color extraction
			const iconSelectors = [
				'link[rel="apple-touch-icon"]',
				'link[rel="apple-touch-icon-precomposed"]',
				'link[rel="icon"][type="image/png"]',
				'link[rel="shortcut icon"]',
				'link[rel="icon"]',
			];
			for (const sel of iconSelectors) {
				try {
					const link = document.querySelector(sel);
					if (!link?.href) continue;
					const img = new Image();
					img.crossOrigin = "anonymous";
					img.src = link.href;
					if (!img.complete || img.naturalWidth === 0) continue;
					const canvas = document.createElement("canvas");
					const sz = 32;
					canvas.width = sz; canvas.height = sz;
					const ctx = canvas.getContext("2d");
					ctx.drawImage(img, 0, 0, sz, sz);
					const data = ctx.getImageData(0, 0, sz, sz).data;
					const buckets = {};
					for (let i = 0; i < data.length; i += 4) {
						const r = data[i], g = data[i+1], b = data[i+2], a = data[i+3];
						if (a < 128) continue;
						if (!isViable(r, g, b)) continue;
						const key = `${(r>>4)<<4},${(g>>4)<<4},${(b>>4)<<4}`;
						buckets[key] = (buckets[key] || 0) + 1;
					}
					let best = null, bestCount = 0;
					for (const [k, count] of Object.entries(buckets)) {
						if (count > bestCount) { bestCount = count; best = k; }
					}
					if (best && bestCount > 10) {
						applyBrandColor(`rgb(${best})`);
						return;
					}
				} catch {}
			}

			// 6. Dominant link color (excluding black/white/gray and default browser blue)
			const linkBuckets = {};
			for (const a of document.querySelectorAll("a")) {
				const c = parseColor(window.getComputedStyle(a).color);
				if (!c || !isViable(...c)) continue;
				const key = c.join(",");
				linkBuckets[key] = (linkBuckets[key] || 0) + 1;
			}
			let bestLink = null, bestLinkCount = 0;
			for (const [key, count] of Object.entries(linkBuckets)) {
				if (count > bestLinkCount) { bestLinkCount = count; bestLink = key; }
			}
			if (bestLink && bestLinkCount >= 2) {
				applyBrandColor(`rgb(${bestLink})`);
				return;
			}

			// 7. Prominent colored UI element (sub-nav, accent bar, etc.)
			for (const el of document.querySelectorAll("div, section, span, nav")) {
				const r = el.getBoundingClientRect();
				if (r.width < 200 || r.height < 5) continue;
				const c = parseColor(window.getComputedStyle(el).backgroundColor);
				if (c && isViable(...c)) {
					applyBrandColor(`rgb(${c[0]},${c[1]},${c[2]})`);
					return;
				}
			}

			// 8. msapplication-TileColor
			const tile = document.querySelector('meta[name="msapplication-TileColor"]');
			if (tile) {
				const c = parseColor(tile.getAttribute("content"));
				if (c && isViable(...c)) {
					applyBrandColor(`rgb(${c[0]},${c[1]},${c[2]})`);
					return;
				}
			}
		});

		// ── Scroll through the page to trigger lazy-loaded images ──
		await page.evaluate(async () => {
			for (const img of document.querySelectorAll("img")) {
				img.setAttribute("loading", "eager");
				const dataSrc = img.getAttribute("data-src") || img.getAttribute("data-lazy-src") || img.getAttribute("data-original");
				if (dataSrc && !img.src) img.src = dataSrc;
				if (dataSrc && img.src.startsWith("data:")) img.src = dataSrc;
			}
			const step = window.innerHeight * 2;
			const max = document.body.scrollHeight;
			for (let y = 0; y < max; y += step) {
				window.scrollTo(0, y);
				await new Promise(r => setTimeout(r, 50));
			}
			window.scrollTo(0, 0);
		});

		// Brief wait for images to load (cap at 3s)
		await page.evaluate(() => Promise.race([
			Promise.allSettled(
				[...document.querySelectorAll("img[src]")]
					.filter(i => !i.complete)
					.map(i => new Promise(r => { i.onload = r; i.onerror = r; }))
			),
			new Promise(r => setTimeout(r, 3000)),
		]));

		await new Promise((r) => setTimeout(r, 300));

		const out = resolve(outputPath);
		mkdirSync(dirname(out), { recursive: true });

		const clip = await page.evaluate(() => {
			const vw = window.innerWidth;
			const W = "[data-deeperdive-mock]";

			const candidates = [
				...document.querySelectorAll(
					'article p, article h1, article h2, article h3, ' +
					'article figure, article img, article blockquote, ' +
					'[role="article"] p, [role="article"] figure, ' +
					'main p, main h1, main h2, main figure, ' +
					'.article-body p, .post-content p, .entry-content p, ' +
					'#mw-content-text p, #mw-content-text figure',
				),
				document.querySelector("h1"),
				document.querySelector(W),
			].filter(Boolean);

			let bottom = 0;

			for (const el of candidates) {
				const st = window.getComputedStyle(el);
				if (st.display === "none" || st.visibility === "hidden") continue;
				const r = el.getBoundingClientRect();
				if (r.height < 2 || r.width < 40) continue;
				bottom = Math.max(bottom, r.bottom);
			}

			if (bottom <= 0) return null;

			const pad = 40;
			const maxHeight = 5000;
			const rawHeight = bottom + window.scrollY + pad;
			return {
				x: 0,
				y: 0,
				width: vw,
				height: Math.min(Math.round(rawHeight), maxHeight),
			};
		});

		if (clip) {
			await page.screenshot({ path: out, type: "png", clip });
		} else {
			await page.screenshot({ path: out, type: "png" });
		}

		return {
			outputPath: out,
			placement,
			generatedContent: {
				summary: summary || "",
				question1: question1 || "",
				question2: question2 || "",
				candidateQuestions: allCandidateQuestions,
				publication: siteName || publication || "",
				lang: pageLang,
			},
		};
	} finally {
		await browser.close();
	}
}

async function main() {
	const opts = parseArgs(process.argv);
	if (!opts.url) {
		console.error("Missing --url <https://...>");
		process.exit(1);
	}
	const { outputPath, placement } = await capturePageToPng({
		url: opts.url,
		outputPath: resolve(process.cwd(), opts.output),
		waitUntil: opts.waitUntil,
		timeout: opts.timeout,
		publication: opts.publication,
	});
	console.log(`Saved ${outputPath} (${placement.placement})`);
}

const __filename = fileURLToPath(import.meta.url);
const invokedAsCli =
	process.argv[1] &&
	path.resolve(process.cwd(), process.argv[1]) === path.resolve(__filename);

if (invokedAsCli) {
	main().catch((err) => {
		console.error(err.message || err);
		process.exit(1);
	});
}
