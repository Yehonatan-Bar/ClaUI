import React, { useState, useRef, useEffect } from 'react';
import { postToExtension } from '../../hooks/useClaudeStream';

type LangCode =
  | 'en' | 'he' | 'es' | 'fr' | 'de' | 'ru'
  | 'zh-cn' | 'ja' | 'ko' | 'ar' | 'pt' | 'it'
  | 'nl' | 'pl' | 'tr' | 'hi';

interface LangEntry {
  label: string;
  dir: 'ltr' | 'rtl';
  title: string;
  explanation: string;
  question: string;
  enableBtn: string;
  skipBtn: string;
  translateBtn: string;
}

const TRANSLATIONS: Record<LangCode, LangEntry> = {
  en: {
    label: 'English',
    dir: 'ltr',
    title: 'SkillDocs — AI Skill Generation',
    explanation:
      'SkillDocs learns from your development work and creates reusable AI skills for Claude.\n\n' +
      'How it works:\n' +
      '  \u2022 Reads your task documentation (SR-PTD files)\n' +
      '  \u2022 Uses AI to find patterns and cluster related knowledge\n' +
      '  \u2022 Generates skill files in ~/.claude/skills/\n' +
      '  \u2022 Adds a skill-building prompt to your CLAUDE.md file\n\n' +
      'Result: Claude gets smarter about your codebase and workflows over time.\n' +
      'Skills accumulate silently in the background \u2014 you choose when to generate.',
    question: 'Enable SkillDocs and let Claude learn from your work?',
    enableBtn: 'Enable',
    skipBtn: 'Skip',
    translateBtn: 'Translate',
  },
  he: {
    label: '\u05e2\u05d1\u05e8\u05d9\u05ea',
    dir: 'rtl',
    title: 'SkillDocs \u2014 \u05d9\u05e6\u05d9\u05e8\u05ea \u05db\u05d9\u05e9\u05d5\u05e8\u05d9 AI',
    explanation:
      'SkillDocs \u05dc\u05d5\u05de\u05d3 \u05de\u05e2\u05d1\u05d5\u05d3\u05ea \u05d4\u05e4\u05d9\u05ea\u05d5\u05d7 \u05e9\u05dc\u05da \u05d5\u05d9\u05d5\u05e6\u05e8 \u05db\u05d9\u05e9\u05d5\u05e8\u05d9 AI \u05dc\u05e9\u05d9\u05de\u05d5\u05e9 \u05d7\u05d5\u05d6\u05e8 \u05e2\u05d1\u05d5\u05e8 Claude.\n\n' +
      '\u05db\u05d9\u05e6\u05d3 \u05d6\u05d4 \u05e2\u05d5\u05d1\u05d3:\n' +
      '  \u2022 \u05e7\u05d5\u05e8\u05d0 \u05d0\u05ea \u05e7\u05d1\u05e6\u05d9 \u05d4\u05d3\u05d5\u05e7\u05d5\u05de\u05e0\u05d8\u05e6\u05d9\u05d4 \u05e9\u05dc\u05da (SR-PTD)\n' +
      '  \u2022 \u05de\u05e9\u05ea\u05de\u05e9 \u05d1-AI \u05dc\u05d6\u05d9\u05d4\u05d5\u05d9 \u05d3\u05e4\u05d5\u05e1\u05d9\u05dd \u05d5\u05d0\u05e9\u05db\u05d5\u05dc \u05d9\u05d3\u05e2 \u05e7\u05e9\u05d5\u05e8\n' +
      '  \u2022 \u05d9\u05d5\u05e6\u05e8 \u05e7\u05d1\u05e6\u05d9 \u05db\u05d9\u05e9\u05d5\u05e8\u05d9\u05dd \u05d1\u05ea\u05d9\u05e7\u05d9\u05d9\u05d4 ~/.claude/skills/\n' +
      '  \u2022 \u05de\u05d5\u05e1\u05d9\u05e3 \u05d4\u05d5\u05e8\u05d0\u05d5\u05ea \u05dc\u05e7\u05d5\u05d1\u05e5 CLAUDE.md \u05e9\u05dc\u05da\n\n' +
      '\u05ea\u05d5\u05e6\u05d0\u05d4: Claude \u05de\u05ea\u05d7\u05db\u05dd \u05dc\u05d2\u05d1\u05d9 \u05d4-codebase \u05d5\u05d4\u05d6\u05e8\u05d9\u05de\u05d5\u05ea \u05e9\u05dc\u05da \u05dc\u05d0\u05d5\u05e8\u05da \u05d6\u05de\u05df.\n' +
      '\u05db\u05d9\u05e9\u05d5\u05e8\u05d9\u05dd \u05de\u05e6\u05d8\u05d1\u05e8\u05d9\u05dd \u05d1\u05e9\u05e7\u05d8 \u05d1\u05e8\u05e7\u05e2 \u2014 \u05d0\u05ea\u05d4 \u05d1\u05d5\u05d7\u05e8 \u05de\u05ea\u05d9 \u05dc\u05d9\u05e6\u05d5\u05e8 \u05d0\u05d5\u05ea\u05dd.',
    question: '\u05d4\u05d0\u05dd \u05dc\u05d4\u05e4\u05e2\u05d9\u05dc \u05d0\u05ea SkillDocs \u05d5\u05dc\u05d0\u05e4\u05e9\u05e8 \u05dc-Claude \u05dc\u05dc\u05de\u05d5\u05d3 \u05de\u05e2\u05d1\u05d5\u05d3\u05ea\u05da?',
    enableBtn: '\u05d4\u05e4\u05e2\u05dc',
    skipBtn: '\u05d3\u05dc\u05d2',
    translateBtn: '\u05ea\u05e8\u05d2\u05dd',
  },
  es: {
    label: 'Espa\u00f1ol',
    dir: 'ltr',
    title: 'SkillDocs \u2014 Generaci\u00f3n de Habilidades IA',
    explanation:
      'SkillDocs aprende de tu trabajo de desarrollo y crea habilidades de IA reutilizables para Claude.\n\n' +
      'C\u00f3mo funciona:\n' +
      '  \u2022 Lee tu documentaci\u00f3n de tareas (archivos SR-PTD)\n' +
      '  \u2022 Usa IA para encontrar patrones y agrupar conocimiento relacionado\n' +
      '  \u2022 Genera archivos de habilidades en ~/.claude/skills/\n' +
      '  \u2022 Agrega instrucciones a tu archivo CLAUDE.md\n\n' +
      'Resultado: Claude se vuelve m\u00e1s inteligente sobre tu base de c\u00f3digo y flujos de trabajo con el tiempo.\n' +
      'Las habilidades se acumulan en segundo plano \u2014 t\u00fa decides cu\u00e1ndo generarlas.',
    question: '\u00bfActivar SkillDocs y dejar que Claude aprenda de tu trabajo?',
    enableBtn: 'Activar',
    skipBtn: 'Omitir',
    translateBtn: 'Traducir',
  },
  fr: {
    label: 'Fran\u00e7ais',
    dir: 'ltr',
    title: 'SkillDocs \u2014 G\u00e9n\u00e9ration de Comp\u00e9tences IA',
    explanation:
      'SkillDocs apprend de votre travail de d\u00e9veloppement et cr\u00e9e des comp\u00e9tences IA r\u00e9utilisables pour Claude.\n\n' +
      'Comment \u00e7a fonctionne\u00a0:\n' +
      '  \u2022 Lit votre documentation de t\u00e2ches (fichiers SR-PTD)\n' +
      '  \u2022 Utilise l\u2019IA pour trouver des mod\u00e8les et regrouper les connaissances\n' +
      '  \u2022 G\u00e9n\u00e8re des fichiers de comp\u00e9tences dans ~/.claude/skills/\n' +
      '  \u2022 Ajoute des instructions \u00e0 votre fichier CLAUDE.md\n\n' +
      'R\u00e9sultat\u00a0: Claude devient plus intelligent sur votre base de code et vos workflows au fil du temps.\n' +
      'Les comp\u00e9tences s\u2019accumulent silencieusement en arri\u00e8re-plan.',
    question: 'Activer SkillDocs et laisser Claude apprendre de votre travail\u00a0?',
    enableBtn: 'Activer',
    skipBtn: 'Ignorer',
    translateBtn: 'Traduire',
  },
  de: {
    label: 'Deutsch',
    dir: 'ltr',
    title: 'SkillDocs \u2014 KI-F\u00e4higkeitsgenerierung',
    explanation:
      'SkillDocs lernt von Ihrer Entwicklungsarbeit und erstellt wiederverwendbare KI-F\u00e4higkeiten f\u00fcr Claude.\n\n' +
      'So funktioniert es:\n' +
      '  \u2022 Liest Ihre Aufgabendokumentation (SR-PTD-Dateien)\n' +
      '  \u2022 Nutzt KI, um Muster zu finden und verwandtes Wissen zu clustern\n' +
      '  \u2022 Generiert Skill-Dateien in ~/.claude/skills/\n' +
      '  \u2022 F\u00fcgt Anweisungen zu Ihrer CLAUDE.md-Datei hinzu\n\n' +
      'Ergebnis: Claude wird im Laufe der Zeit intelligenter \u00fcber Ihre Codebasis und Arbeitsabl\u00e4ufe.\n' +
      'F\u00e4higkeiten akkumulieren still im Hintergrund.',
    question: 'SkillDocs aktivieren und Claude von Ihrer Arbeit lernen lassen?',
    enableBtn: 'Aktivieren',
    skipBtn: '\u00dcberspringen',
    translateBtn: '\u00dcbersetzen',
  },
  ru: {
    label: '\u0420\u0443\u0441\u0441\u043a\u0438\u0439',
    dir: 'ltr',
    title: 'SkillDocs \u2014 \u0413\u0435\u043d\u0435\u0440\u0430\u0446\u0438\u044f \u043d\u0430\u0432\u044b\u043a\u043e\u0432 \u0418\u0418',
    explanation:
      'SkillDocs \u043e\u0431\u0443\u0447\u0430\u0435\u0442\u0441\u044f \u043d\u0430 \u043e\u0441\u043d\u043e\u0432\u0435 \u0432\u0430\u0448\u0435\u0439 \u0440\u0430\u0437\u0440\u0430\u0431\u043e\u0442\u043a\u0438 \u0438 \u0441\u043e\u0437\u0434\u0430\u0451\u0442 \u043c\u043d\u043e\u0433\u043e\u0440\u0430\u0437\u043e\u0432\u044b\u0435 \u043d\u0430\u0432\u044b\u043a\u0438 \u0418\u0418 \u0434\u043b\u044f Claude.\n\n' +
      '\u041a\u0430\u043a \u044d\u0442\u043e \u0440\u0430\u0431\u043e\u0442\u0430\u0435\u0442:\n' +
      '  \u2022 \u0427\u0438\u0442\u0430\u0435\u0442 \u0432\u0430\u0448\u0443 \u0434\u043e\u043a\u0443\u043c\u0435\u043d\u0442\u0430\u0446\u0438\u044e \u0437\u0430\u0434\u0430\u0447 (SR-PTD \u0444\u0430\u0439\u043b\u044b)\n' +
      '  \u2022 \u0418\u0441\u043f\u043e\u043b\u044c\u0437\u0443\u0435\u0442 \u0418\u0418 \u0434\u043b\u044f \u043f\u043e\u0438\u0441\u043a\u0430 \u043f\u0430\u0442\u0442\u0435\u0440\u043d\u043e\u0432 \u0438 \u043a\u043b\u0430\u0441\u0442\u0435\u0440\u0438\u0437\u0430\u0446\u0438\u0438 \u0437\u043d\u0430\u043d\u0438\u0439\n' +
      '  \u2022 \u0421\u043e\u0437\u0434\u0430\u0451\u0442 \u0444\u0430\u0439\u043b\u044b \u043d\u0430\u0432\u044b\u043a\u043e\u0432 \u0432 ~/.claude/skills/\n' +
      '  \u2022 \u0414\u043e\u0431\u0430\u0432\u043b\u044f\u0435\u0442 \u0438\u043d\u0441\u0442\u0440\u0443\u043a\u0446\u0438\u0438 \u0432 \u0432\u0430\u0448 \u0444\u0430\u0439\u043b CLAUDE.md\n\n' +
      '\u0420\u0435\u0437\u0443\u043b\u044c\u0442\u0430\u0442: Claude \u043f\u043e\u0441\u0442\u0435\u043f\u0435\u043d\u043d\u043e \u0443\u043c\u043d\u0435\u0435\u0442 \u0432 \u043e\u0442\u043d\u043e\u0448\u0435\u043d\u0438\u0438 \u0432\u0430\u0448\u0435\u0439 \u043a\u043e\u0434\u043e\u0432\u043e\u0439 \u0431\u0430\u0437\u044b \u0438 \u0440\u0430\u0431\u043e\u0447\u0438\u0445 \u043f\u0440\u043e\u0446\u0435\u0441\u0441\u043e\u0432.\n' +
      '\u041d\u0430\u0432\u044b\u043a\u0438 \u043d\u0430\u043a\u0430\u043f\u043b\u0438\u0432\u0430\u044e\u0442\u0441\u044f \u0442\u0438\u0445\u043e \u0432 \u0444\u043e\u043d\u043e\u0432\u043e\u043c \u0440\u0435\u0436\u0438\u043c\u0435.',
    question: '\u0412\u043a\u043b\u044e\u0447\u0438\u0442\u044c SkillDocs \u0438 \u043f\u043e\u0437\u0432\u043e\u043b\u0438\u0442\u044c Claude \u0443\u0447\u0438\u0442\u044c\u0441\u044f \u043d\u0430 \u0432\u0430\u0448\u0435\u0439 \u0440\u0430\u0431\u043e\u0442\u0435?',
    enableBtn: '\u0412\u043a\u043b\u044e\u0447\u0438\u0442\u044c',
    skipBtn: '\u041f\u0440\u043e\u043f\u0443\u0441\u0442\u0438\u0442\u044c',
    translateBtn: '\u041f\u0435\u0440\u0435\u0432\u0435\u0441\u0442\u0438',
  },
  'zh-cn': {
    label: '\u4e2d\u6587\uff08\u7b80\u4f53\uff09',
    dir: 'ltr',
    title: 'SkillDocs \u2014 AI \u6280\u80fd\u751f\u6210',
    explanation:
      'SkillDocs \u4ece\u60a8\u7684\u5f00\u53d1\u5de5\u4f5c\u4e2d\u5b66\u4e60\uff0c\u4e3a Claude \u521b\u5efa\u53ef\u91cd\u7528\u7684 AI \u6280\u80fd\u3002\n\n' +
      '\u5de5\u4f5c\u539f\u7406\uff1a\n' +
      '  \u2022 \u8bfb\u53d6\u60a8\u7684\u4efb\u52a1\u6587\u6863\uff08SR-PTD \u6587\u4ef6\uff09\n' +
      '  \u2022 \u4f7f\u7528 AI \u53d1\u73b0\u6a21\u5f0f\u5e76\u805a\u7c7b\u76f8\u5173\u77e5\u8bc6\n' +
      '  \u2022 \u5728 ~/.claude/skills/ \u751f\u6210\u6280\u80fd\u6587\u4ef6\n' +
      '  \u2022 \u5411\u60a8\u7684 CLAUDE.md \u6587\u4ef6\u6dfb\u52a0\u8bf4\u660e\n\n' +
      '\u7ed3\u679c\uff1aClaude \u5bf9\u60a8\u7684\u4ee3\u7801\u5e93\u548c\u5de5\u4f5c\u6d41\u7a0b\u4f1a\u968f\u65f6\u95f4\u53d8\u5f97\u66f4\u804a\u660e\u3002\n' +
      '\u6280\u80fd\u5728\u540e\u53f0\u9759\u9ed8\u7d2f\u79ef\u3002',
    question: '\u662f\u5426\u542f\u7528 SkillDocs \u5e76\u8ba9 Claude \u4ece\u60a8\u7684\u5de5\u4f5c\u4e2d\u5b66\u4e60\uff1f',
    enableBtn: '\u542f\u7528',
    skipBtn: '\u8df3\u8fc7',
    translateBtn: '\u7ffb\u8bd1',
  },
  ja: {
    label: '\u65e5\u672c\u8a9e',
    dir: 'ltr',
    title: 'SkillDocs \u2014 AI \u30b9\u30ad\u30eb\u751f\u6210',
    explanation:
      'SkillDocs \u306f\u958b\u767a\u4f5c\u696d\u304b\u3089\u5b66\u7fd2\u3057\u3001Claude \u306e\u305f\u3081\u306e\u518d\u5229\u7528\u53ef\u80fd\u306a AI \u30b9\u30ad\u30eb\u3092\u4f5c\u6210\u3057\u307e\u3059\u3002\n\n' +
      '\u4ed5\u7d44\u307f\uff1a\n' +
      '  \u2022 \u30bf\u30b9\u30af\u30c9\u30ad\u30e5\u30e1\u30f3\u30c8\uff08SR-PTD \u30d5\u30a1\u30a4\u30eb\uff09\u3092\u8aad\u307f\u53d6\u308b\n' +
      '  \u2022 AI \u3092\u4f7f\u7528\u3057\u3066\u30d1\u30bf\u30fc\u30f3\u3092\u898b\u3064\u3051\u3001\u95a2\u9023\u77e5\u8b58\u3092\u30af\u30e9\u30b9\u30bf\u30ea\u30f3\u30b0\n' +
      '  \u2022 ~/.claude/skills/ \u306b\u30b9\u30ad\u30eb\u30d5\u30a1\u30a4\u30eb\u3092\u751f\u6210\n' +
      '  \u2022 CLAUDE.md \u30d5\u30a1\u30a4\u30eb\u306b\u6307\u793a\u3092\u8ffd\u52a0\n\n' +
      '\u7d50\u679c\uff1aClaude \u306f\u6642\u9593\u3068\u3068\u3082\u306b\u30b3\u30fc\u30c9\u30d9\u30fc\u30b9\u3068\u30ef\u30fc\u30af\u30d5\u30ed\u30fc\u306b\u3064\u3044\u3066\u8ce2\u304f\u306a\u308a\u307e\u3059\u3002\n' +
      '\u30b9\u30ad\u30eb\u306f\u30d0\u30c3\u30af\u30b0\u30e9\u30a6\u30f3\u30c9\u3067\u9759\u304b\u306b\u8513\u7a4d\u3055\u308c\u307e\u3059\u3002',
    question: 'SkillDocs \u3092\u6709\u52b9\u306b\u3057\u3066 Claude \u306b\u5b66\u7fd2\u3055\u305b\u307e\u3059\u304b\uff1f',
    enableBtn: '\u6709\u52b9\u306b\u3059\u308b',
    skipBtn: '\u30b9\u30ad\u30c3\u30d7',
    translateBtn: '\u7ffb\u8a33',
  },
  ko: {
    label: '\ud55c\uad6d\uc5b4',
    dir: 'ltr',
    title: 'SkillDocs \u2014 AI \uc2a4\ud0ac \uc0dd\uc131',
    explanation:
      'SkillDocs\ub294 \uac1c\ubc1c \uc791\uc5c5\uc5d0\uc11c \ud559\uc2b5\ud558\uc5ec Claude\ub97c \uc704\ud55c \uc7ac\uc0ac\uc6a9 AI \uc2a4\ud0ac\uc744 \uc0dd\uc131\ud569\ub2c8\ub2e4.\n\n' +
      '\uc791\ub3d9 \ubc29\uc2dd:\n' +
      '  \u2022 \uc791\uc5c5 \ubb38\uc11c(SR-PTD \ud30c\uc77c)\ub97c \uc77d\uc2b5\ub2c8\ub2e4\n' +
      '  \u2022 AI\ub97c \uc0ac\uc6a9\ud558\uc5ec \ud328\ud134\uc744 \ucc3e\uace0 \uad00\ub828 \uc9c0\uc2dd\uc744 \ud074\ub7ec\uc2a4\ud130\ub9c1\n' +
      '  \u2022 ~/.claude/skills/\uc5d0 \uc2a4\ud0ac \ud30c\uc77c \uc0dd\uc131\n' +
      '  \u2022 CLAUDE.md \ud30c\uc77c\uc5d0 \uc9c0\uce68 \ucd94\uac00\n\n' +
      '\uacb0\uacfc: Claude\uac00 \uc2dc\uac04\uc774 \uc9c0\ub0a8\uc5d0 \ub530\ub77c \ucf54\ub4dc\ubca0\uc774\uc2a4\uc640 \uc6cc\ud06c\ud50c\ub85c\uc6b0\uc5d0 \ub300\ud574 \ub354 \ub611\ub611\ud574\uc9d1\ub2c8\ub2e4.\n' +
      '\uc2a4\ud0ac\uc740 \ubc31\uadf8\ub77c\uc6b4\ub4dc\uc5d0\uc11c \uc870\uc6a9\ud788 \ub204\uc801\ub429\ub2c8\ub2e4.',
    question: 'SkillDocs\ub97c \ud65c\uc131\ud654\ud558\uc5ec Claude\uac00 \uc791\uc5c5\uc5d0\uc11c \ud559\uc2b5\ud558\ub3c4\ub85d \ud558\uc2dc\uaca0\uc2b5\ub2c8\uae4c?',
    enableBtn: '\ud65c\uc131\ud654',
    skipBtn: '\uac74\ub108\ub6f0\uae30',
    translateBtn: '\ubc88\uc5ed',
  },
  ar: {
    label: '\u0627\u0644\u0639\u0631\u0628\u064a\u0629',
    dir: 'rtl',
    title: 'SkillDocs \u2014 \u062a\u0648\u0644\u064a\u062f \u0645\u0647\u0627\u0631\u0627\u062a \u0627\u0644\u0630\u0643\u0627\u0621 \u0627\u0644\u0627\u0635\u0637\u0646\u0627\u0639\u064a',
    explanation:
      '\u064a\u062a\u0639\u0644\u0645 SkillDocs \u0645\u0646 \u0639\u0645\u0644\u0643 \u0627\u0644\u062a\u0637\u0648\u064a\u0631\u064a \u0648\u064a\u064f\u0646\u0634\u0626 \u0645\u0647\u0627\u0631\u0627\u062a \u0630\u0643\u0627\u0621 \u0627\u0635\u0637\u0646\u0627\u0639\u064a \u0642\u0627\u0628\u0644\u0629 \u0644\u0625\u0639\u0627\u062f\u0629 \u0627\u0644\u0627\u0633\u062a\u062e\u062f\u0627\u0645 \u0644\u0640 Claude.\n\n' +
      '\u0643\u064a\u0641 \u064a\u0639\u0645\u0644:\n' +
      '  \u2022 \u064a\u0642\u0631\u0623 \u0648\u062b\u0627\u0626\u0642 \u0645\u0647\u0627\u0645\u0643 (SR-PTD)\n' +
      '  \u2022 \u064a\u0633\u062a\u062e\u062f\u0645 \u0627\u0644\u0630\u0643\u0627\u0621 \u0627\u0644\u0627\u0635\u0637\u0646\u0627\u0639\u064a \u0644\u0625\u064a\u062c\u0627\u062f \u0627\u0644\u0623\u0646\u0645\u0627\u0637 \u0648\u062a\u062c\u0645\u064a\u0639 \u0627\u0644\u0645\u0639\u0631\u0641\u0629 \u0627\u0644\u0645\u062a\u0639\u0644\u0642\u0629\n' +
      '  \u2022 \u064a\u0648\u0644\u0651\u062f \u0645\u0644\u0641\u0627\u062a \u0627\u0644\u0645\u0647\u0627\u0631\u0627\u062a \u0641\u064a ~/.claude/skills/\n' +
      '  \u2022 \u064a\u0636\u064a\u0641 \u062a\u0639\u0644\u064a\u0645\u0627\u062a \u0625\u0644\u0649 \u0645\u0644\u0641 CLAUDE.md \u0627\u0644\u062e\u0627\u0635 \u0628\u0643\n\n' +
      '\u0627\u0644\u0646\u062a\u064a\u062c\u0629: \u064a\u0635\u0628\u062d Claude \u0623\u0643\u062b\u0631 \u0630\u0643\u0627\u0621\u064b \u0628\u0634\u0623\u0646 \u0642\u0627\u0639\u062f\u0629 \u0627\u0644\u0634\u064a\u0641\u0631\u0629\u0629 \u0648\u0633\u064a\u0631 \u0627\u0644\u0639\u0645\u0644 \u0645\u0639 \u0645\u0631\u0648\u0631 \u0627\u0644\u0648\u0642\u062a.\n' +
      '\u062a\u062a\u0631\u0627\u0643\u0645 \u0627\u0644\u0645\u0647\u0627\u0631\u0627\u062a \u0628\u0635\u0645\u062a \u0641\u064a \u0627\u0644\u062e\u0644\u0641\u064a\u0629.',
    question: '\u0647\u0644 \u062a\u0631\u064a\u062f \u062a\u0641\u0639\u064a\u0644 SkillDocs \u0648\u0627\u0644\u0633\u0645\u0627\u062d \u0644\u0640 Claude \u0628\u0627\u0644\u062a\u0639\u0644\u0645 \u0645\u0646 \u0639\u0645\u0644\u0643?',
    enableBtn: '\u062a\u0641\u0639\u064a\u0644',
    skipBtn: '\u062a\u062e\u0637\u0651\u064a',
    translateBtn: '\u062a\u0631\u062c\u0645\u0629',
  },
  pt: {
    label: 'Portugu\u00eas',
    dir: 'ltr',
    title: 'SkillDocs \u2014 Gera\u00e7\u00e3o de Habilidades IA',
    explanation:
      'SkillDocs aprende com o seu trabalho de desenvolvimento e cria habilidades de IA reutiliz\u00e1veis para Claude.\n\n' +
      'Como funciona:\n' +
      '  \u2022 L\u00ea sua documenta\u00e7\u00e3o de tarefas (arquivos SR-PTD)\n' +
      '  \u2022 Usa IA para encontrar padr\u00f5es e agrupar conhecimento relacionado\n' +
      '  \u2022 Gera arquivos de habilidades em ~/.claude/skills/\n' +
      '  \u2022 Adiciona instru\u00e7\u00f5es ao seu arquivo CLAUDE.md\n\n' +
      'Resultado: Claude fica mais inteligente sobre sua base de c\u00f3digo e fluxos de trabalho ao longo do tempo.\n' +
      'As habilidades se acumulam silenciosamente em segundo plano.',
    question: 'Ativar SkillDocs e deixar Claude aprender com o seu trabalho?',
    enableBtn: 'Ativar',
    skipBtn: 'Pular',
    translateBtn: 'Traduzir',
  },
  it: {
    label: 'Italiano',
    dir: 'ltr',
    title: 'SkillDocs \u2014 Generazione di Competenze IA',
    explanation:
      'SkillDocs impara dal tuo lavoro di sviluppo e crea competenze AI riutilizzabili per Claude.\n\n' +
      'Come funziona:\n' +
      '  \u2022 Legge la tua documentazione dei compiti (file SR-PTD)\n' +
      '  \u2022 Usa l\u2019AI per trovare modelli e raggruppare conoscenze correlate\n' +
      '  \u2022 Genera file di competenze in ~/.claude/skills/\n' +
      '  \u2022 Aggiunge istruzioni al tuo file CLAUDE.md\n\n' +
      'Risultato: Claude diventa pi\u00f9 intelligente sulla tua codebase e sui tuoi flussi di lavoro nel tempo.\n' +
      'Le competenze si accumulano silenziosamente in background.',
    question: 'Attivare SkillDocs e lasciare che Claude impari dal tuo lavoro?',
    enableBtn: 'Attiva',
    skipBtn: 'Salta',
    translateBtn: 'Traduci',
  },
  nl: {
    label: 'Nederlands',
    dir: 'ltr',
    title: 'SkillDocs \u2014 AI-vaardighedengeneratie',
    explanation:
      'SkillDocs leert van uw ontwikkelwerk en maakt herbruikbare AI-vaardigheden voor Claude.\n\n' +
      'Hoe het werkt:\n' +
      '  \u2022 Leest uw taakdocumentatie (SR-PTD-bestanden)\n' +
      '  \u2022 Gebruikt AI om patronen te vinden en gerelateerde kennis te clusteren\n' +
      '  \u2022 Genereert vaardigheidsbestanden in ~/.claude/skills/\n' +
      '  \u2022 Voegt instructies toe aan uw CLAUDE.md-bestand\n\n' +
      'Resultaat: Claude wordt mettertijd slimmer over uw codebase en workflows.\n' +
      'Vaardigheden worden stil op de achtergrond opgebouwd.',
    question: 'SkillDocs inschakelen en Claude van uw werk laten leren?',
    enableBtn: 'Inschakelen',
    skipBtn: 'Overslaan',
    translateBtn: 'Vertalen',
  },
  pl: {
    label: 'Polski',
    dir: 'ltr',
    title: 'SkillDocs \u2014 Generowanie Umiej\u0119tno\u015bci AI',
    explanation:
      'SkillDocs uczy si\u0119 z Twojej pracy deweloperskiej i tworzy wielokrotnego u\u017cytku umiej\u0119tno\u015bci AI dla Claude.\n\n' +
      'Jak to dzia\u0142a:\n' +
      '  \u2022 Czyta Twoj\u0105 dokumentacj\u0119 zada\u0144 (pliki SR-PTD)\n' +
      '  \u2022 U\u017cywa AI do znajdowania wzor\u00f3w i grupowania powi\u0105zanej wiedzy\n' +
      '  \u2022 Generuje pliki umiej\u0119tno\u015bci w ~/.claude/skills/\n' +
      '  \u2022 Dodaje instrukcje do Twojego pliku CLAUDE.md\n\n' +
      'Wynik: Claude staje si\u0119 m\u0105drzejszy w kwestii Twojej bazy kodu i przep\u0142yw\u00f3w pracy z czasem.\n' +
      'Umiej\u0119tno\u015bci s\u0105 cicho gromadzone w tle.',
    question: 'W\u0142\u0105czy\u0107 SkillDocs i pozwoli\u0107 Claude uczy\u0107 si\u0119 z Twojej pracy?',
    enableBtn: 'W\u0142\u0105cz',
    skipBtn: 'Pomin',
    translateBtn: 'T\u0142umacz',
  },
  tr: {
    label: 'T\u00fcrk\u00e7e',
    dir: 'ltr',
    title: 'SkillDocs \u2014 AI Beceri \u00dcretimi',
    explanation:
      'SkillDocs geli\u015ftirme \u00e7al\u0131\u015fman\u0131zdan \u00f6\u011frenir ve Claude i\u00e7in yeniden kullan\u0131labilir AI becerileri olu\u015fturur.\n\n' +
      'Nas\u0131l \u00e7al\u0131\u015f\u0131r:\n' +
      '  \u2022 G\u00f6rev belgelerinizi (SR-PTD dosyalar\u0131) okur\n' +
      '  \u2022 Kal\u0131plar bulmak ve ilgili bilgileri k\u00fcmelemek i\u00e7in AI kullan\u0131r\n' +
      '  \u2022 ~/.claude/skills/ dizininde beceri dosyalar\u0131 olu\u015fturur\n' +
      '  \u2022 CLAUDE.md dosyan\u0131za talimatlar ekler\n\n' +
      'Sonu\u00e7: Claude zamanla kod taban\u0131n\u0131z ve i\u015f ak\u0131\u015flar\u0131n\u0131z hakk\u0131nda daha ak\u0131ll\u0131 hale gelir.\n' +
      'Beceriler arka planda sessizce birikir.',
    question: 'SkillDocs\'u etkinle\u015ftirmek ve Claude\'un \u00e7al\u0131\u015fman\u0131zdan \u00f6\u011frenmesine izin vermek ister misiniz?',
    enableBtn: 'Etkinle\u015ftir',
    skipBtn: 'Atla',
    translateBtn: '\u00c7evir',
  },
  hi: {
    label: '\u0939\u093f\u0928\u094d\u0926\u0940',
    dir: 'ltr',
    title: 'SkillDocs \u2014 AI \u0915\u094c\u0936\u0932 \u0928\u093f\u0930\u094d\u092e\u093e\u0923',
    explanation:
      'SkillDocs \u0906\u092a\u0915\u0947 \u0935\u093f\u0915\u093e\u0938 \u0915\u093e\u0930\u094d\u092f \u0938\u0947 \u0938\u0940\u0916\u0924\u093e \u0939\u0948 \u0914\u0930 Claude \u0915\u0947 \u0932\u093f\u090f \u092a\u0941\u0928:\u0909\u092a\u092f\u094b\u0917\u0940 AI \u0915\u094c\u0936\u0932 \u092c\u0928\u093e\u0924\u093e \u0939\u0948\u0964\n\n' +
      '\u092f\u0939 \u0915\u0948\u0938\u0947 \u0915\u093e\u092e \u0915\u0930\u0924\u093e \u0939\u0948:\n' +
      '  \u2022 \u0906\u092a\u0915\u0940 \u0915\u093e\u0930\u094d\u092f \u0926\u0938\u094d\u0924\u093e\u0935\u0947\u091c\u093c\u0940\u0915\u0930\u0923 (SR-PTD \u092b\u093c\u093e\u0907\u0932\u0947\u0902) \u092a\u0922\u093c\u0924\u093e \u0939\u0948\n' +
      '  \u2022 \u092a\u0948\u091f\u0930\u094d\u0928 \u0916\u094b\u091c\u0928\u0947 \u0914\u0930 \u0938\u0902\u092c\u0902\u0927\u093f\u0924 \u091c\u094d\u091e\u093e\u0928 \u0915\u094b \u0915\u094d\u0932\u0938\u094d\u091f\u0930 \u0915\u0930\u0928\u0947 \u0915\u0947 \u0932\u093f\u090f AI \u0915\u093e \u0909\u092a\u092f\u094b\u0917 \u0915\u0930\u0924\u093e \u0939\u0948\n' +
      '  \u2022 ~/.claude/skills/ \u092e\u0947\u0902 \u0915\u094c\u0936\u0932 \u092b\u093c\u093e\u0907\u0932\u0947\u0902 \u091c\u0928\u0930\u0947\u091f \u0915\u0930\u0924\u093e \u0939\u0948\n' +
      '  \u2022 \u0906\u092a\u0915\u0940 CLAUDE.md \u092b\u093c\u093e\u0907\u0932 \u092e\u0947\u0902 \u0928\u093f\u0930\u094d\u0926\u0947\u0936 \u091c\u094b\u0921\u093c\u0924\u093e \u0939\u0948\n\n' +
      '\u092a\u0930\u093f\u0923\u093e\u092e: Claude \u0938\u092e\u092f \u0915\u0947 \u0938\u093e\u0925 \u0906\u092a\u0915\u0947 \u0915\u094b\u0921\u092c\u0947\u0938 \u0914\u0930 \u0935\u0930\u094d\u0915\u092b\u093c\u094d\u0932\u094b \u0915\u0947 \u092c\u093e\u0930\u0947 \u092e\u0947\u0902 \u0938\u094d\u092e\u093e\u0930\u094d\u091f \u0939\u094b\u0924\u093e \u091c\u093e\u0924\u093e \u0939\u0948\u0964\n' +
      '\u0915\u094c\u0936\u0932 \u092a\u0943\u0937\u094d\u0920\u092d\u0942\u092e\u093f \u092e\u0947\u0902 \u091a\u0941\u092a\u091a\u093e\u092a \u091c\u092e\u093e \u0939\u094b\u0924\u0947 \u0939\u0948\u0902\u0964',
    question: 'SkillDocs \u0938\u0915\u094d\u0937\u092e \u0915\u0930\u0947\u0902 \u0914\u0930 Claude \u0915\u094b \u0906\u092a\u0915\u0947 \u0915\u093e\u092e \u0938\u0947 \u0938\u0940\u0916\u0928\u0947 \u0926\u0947\u0902?',
    enableBtn: '\u0938\u0915\u094d\u0937\u092e \u0915\u0930\u0947\u0902',
    skipBtn: '\u091b\u094b\u0921\u093c\u0947\u0902',
    translateBtn: '\u0905\u0928\u0941\u0935\u093e\u0926',
  },
};

const LANG_ORDER: LangCode[] = [
  'en', 'he', 'es', 'fr', 'de', 'ru', 'zh-cn', 'ja', 'ko', 'ar', 'pt', 'it', 'nl', 'pl', 'tr', 'hi',
];

/**
 * First-time onboarding component for SkillDocs.
 * Shows a pulsing FAB button that, when clicked, opens a modal explaining the
 * feature in the user's language. After the user decides (enable or skip),
 * the FAB disappears and SkillDocs moves to its normal place in the Tools dropdown.
 */
export const SkillGenOnboarding: React.FC = () => {
  const [modalOpen, setModalOpen] = useState(false);
  const [lang, setLang] = useState<LangCode>('en');
  const [langDropdownOpen, setLangDropdownOpen] = useState(false);
  const langDropdownRef = useRef<HTMLDivElement>(null);

  // Close language dropdown on outside click
  useEffect(() => {
    if (!langDropdownOpen) return;
    const handler = (e: MouseEvent) => {
      if (langDropdownRef.current && !langDropdownRef.current.contains(e.target as Node)) {
        setLangDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [langDropdownOpen]);

  const t = TRANSLATIONS[lang];

  const handleDecision = (accepted: boolean) => {
    postToExtension({ type: 'skillGenOnboardingDecision', accepted });
    setModalOpen(false);
  };

  const handleSelectLang = (code: LangCode) => {
    setLang(code);
    setLangDropdownOpen(false);
  };

  return (
    <>
      {/* Small, quiet icon button */}
      <button
        className="skilldocs-fab"
        onClick={() => setModalOpen(true)}
        title="SkillDocs — click to learn more"
        aria-label="SkillDocs"
      >
        <span className="skilldocs-fab-icon">&#10024;</span>
      </button>

      {/* Modal */}
      {modalOpen && (
        <div className="skilldocs-modal-backdrop" onClick={() => setModalOpen(false)}>
          <div
            className="skilldocs-modal"
            dir={t.dir}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="skilldocs-modal-header">
              <span className="skilldocs-modal-title">{t.title}</span>
              <div className="skilldocs-lang-wrapper" ref={langDropdownRef}>
                <button
                  className="skilldocs-translate-btn"
                  onClick={() => setLangDropdownOpen((o) => !o)}
                  title="Translate"
                >
                  {t.translateBtn} &#9660;
                </button>
                {langDropdownOpen && (
                  <div className="skilldocs-lang-dropdown">
                    {LANG_ORDER.map((code) => (
                      <button
                        key={code}
                        className={`skilldocs-lang-option${lang === code ? ' active' : ''}`}
                        onClick={() => handleSelectLang(code)}
                      >
                        {TRANSLATIONS[code].label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Body */}
            <div className="skilldocs-modal-body">
              {t.explanation.split('\n').map((line, i) => (
                <p key={i} className={line.trim().startsWith('\u2022') ? 'skilldocs-bullet' : 'skilldocs-para'}>
                  {line || '\u00a0'}
                </p>
              ))}
            </div>

            {/* Question */}
            <div className="skilldocs-modal-question">{t.question}</div>

            {/* Footer */}
            <div className="skilldocs-modal-footer">
              <button className="skilldocs-enable-btn" onClick={() => handleDecision(true)}>
                {t.enableBtn}
              </button>
              <button className="skilldocs-skip-btn" onClick={() => handleDecision(false)}>
                {t.skipBtn}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
