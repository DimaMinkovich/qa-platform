/**
 * AI Service — Gemini-powered test generation, duplicate detection, root cause analysis, and risk prediction.
 * Uses Google Gemini 2.0 Flash (free tier: 1,500 requests/day).
 * Falls back to heuristic algorithms when no API key is configured.
 */
class AIService {
  constructor() {
    this.apiKey = process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY;
    this.provider = process.env.GEMINI_API_KEY ? 'gemini' : process.env.OPENAI_API_KEY ? 'openai' : 'heuristic';
    this.geminiModel = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
    this.geminiBaseUrl = 'https://generativelanguage.googleapis.com/v1beta/models';
    this.language = process.env.AI_LANGUAGE || 'he';
  }

  getStatus() {
    return {
      provider: this.provider,
      model: this.provider === 'gemini' ? this.geminiModel : this.provider === 'openai' ? 'gpt-4o' : 'heuristic-v1',
      language: this.language,
      connected: this.provider !== 'heuristic'
    };
  }

  async _callGemini(prompt, options = {}) {
    const url = `${this.geminiBaseUrl}/${this.geminiModel}:generateContent?key=${this.apiKey}`;

    const body = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: options.temperature || 0.7,
        maxOutputTokens: options.maxTokens || 8192,
        responseMimeType: 'application/json',
      }
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(`Gemini API error: ${err.error?.message || res.statusText}`);
    }

    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error('Empty response from Gemini');

    try {
      return JSON.parse(text);
    } catch {
      return { raw: text };
    }
  }

  // ==================== TEST GENERATION ====================

  async generateTests(sourceType, content, options = {}) {
    if (this.provider !== 'heuristic') {
      return this._generateWithGemini(sourceType, content, options);
    }
    return this._generateWithHeuristics(sourceType, content, options);
  }

  async _generateWithGemini(sourceType, content, options) {
    const langInstruction = this.language === 'he'
      ? 'כתוב את כל התסריטים בעברית. כל השדות (title, description, steps) חייבים להיות בעברית.'
      : 'Write all test cases in English.';

    const sourceLabel = {
      prd: 'PRD (Product Requirements Document)',
      user_story: 'User Stories',
      api_spec: 'API Specification',
      technical_doc: 'Technical Document',
      free_text: 'Requirements Description'
    }[sourceType] || 'Requirements';

    const prompt = `אתה מומחה QA בכיר עם 15 שנות ניסיון. תפקידך ליצור תסריטי בדיקה מקיפים.

${langInstruction}

קיבלת ${sourceLabel}:
---
${content}
---

צור תסריטי בדיקה מקיפים הכוללים:
1. בדיקות פונקציונליות (Positive tests)
2. בדיקות שליליות (Negative tests) 
3. בדיקות קצה (Edge cases)
4. בדיקות אבטחה (Security tests) אם רלוונטי
5. בדיקות ביצועים (Performance) אם רלוונטי

עבור כל תסריט בדיקה, ספק:
- test_key: מזהה ייחודי (AI-001, AI-002...)
- title: כותרת קצרה וברורה
- description: תיאור מה הבדיקה בודקת
- priority: 1 (קריטי), 2 (גבוה), 3 (בינוני), 4 (נמוך)
- type: "manual" או "automated"
- steps: מערך של צעדים, כל צעד עם action ו-expected_result

וגם Traceability Matrix שמקשרת דרישות לתסריטים.

החזר JSON בפורמט הזה בלבד:
{
  "tests": [
    {
      "test_key": "AI-001",
      "title": "...",
      "description": "...",
      "priority": 1,
      "type": "manual",
      "steps": [
        { "action": "...", "expected_result": "..." }
      ]
    }
  ],
  "traceabilityMatrix": [
    { "requirement": "...", "testCases": ["AI-001", "AI-002"] }
  ]
}`;

    try {
      const result = await this._callGemini(prompt, { temperature: 0.5, maxTokens: 8192 });

      const tests = result.tests || [];
      const matrix = result.traceabilityMatrix || [];

      return {
        tests,
        traceabilityMatrix: matrix,
        model: `gemini/${this.geminiModel}`,
        confidence: 0.88,
        totalGenerated: tests.length
      };
    } catch (err) {
      console.error('Gemini test generation failed, falling back to heuristics:', err.message);
      const fallback = this._generateWithHeuristics(sourceType, content, options);
      fallback.model = `heuristic-v1 (Gemini fallback: ${err.message})`;
      return fallback;
    }
  }

  // ==================== DUPLICATE DETECTION ====================

  async detectDuplicates(title, description, existingBugs) {
    if (this.provider !== 'heuristic' && existingBugs.length > 0) {
      try {
        return await this._detectDuplicatesWithGemini(title, description, existingBugs);
      } catch (err) {
        console.error('Gemini duplicate detection failed, using heuristics:', err.message);
      }
    }
    return this._detectDuplicatesHeuristic(title, description, existingBugs);
  }

  async _detectDuplicatesWithGemini(title, description, existingBugs) {
    const bugList = existingBugs.slice(0, 50).map(b => `[${b.bug_key}] ${b.title} (${b.status})`).join('\n');

    const prompt = `אתה מערכת AI לזיהוי באגים כפולים.

באג חדש שדווח:
כותרת: ${title}
תיאור: ${description || 'אין תיאור'}

רשימת באגים קיימים:
${bugList}

מצא באגים שעשויים להיות כפילויות של הבאג החדש. 
החזר JSON בפורמט:
{
  "duplicates": [
    { "bug_key": "...", "similarity_score": 0.85, "reason": "..." }
  ]
}

similarity_score: 0.0-1.0 (רק באגים עם score מעל 0.3)
אם אין כפילויות, החזר מערך ריק.`;

    const result = await this._callGemini(prompt, { temperature: 0.2 });

    return (result.duplicates || []).map(d => {
      const bug = existingBugs.find(b => b.bug_key === d.bug_key);
      return {
        bug_id: bug?.id,
        bug_key: d.bug_key,
        title: bug?.title || '',
        status: bug?.status || '',
        similarity_score: d.similarity_score,
        reason: d.reason
      };
    }).filter(d => d.bug_id);
  }

  _detectDuplicatesHeuristic(title, description, existingBugs) {
    const results = [];
    const titleWords = this._tokenize(title);
    const descWords = description ? this._tokenize(description) : [];

    for (const bug of existingBugs) {
      const bugTitleWords = this._tokenize(bug.title);
      const bugDescWords = bug.description ? this._tokenize(bug.description) : [];
      const titleSimilarity = this._jaccardSimilarity(titleWords, bugTitleWords);
      const descSimilarity = descWords.length > 0 && bugDescWords.length > 0
        ? this._jaccardSimilarity(descWords, bugDescWords) : 0;
      const score = titleSimilarity * 0.6 + descSimilarity * 0.4;

      if (score > 0.25) {
        results.push({ bug_id: bug.id, bug_key: bug.bug_key, title: bug.title, status: bug.status, similarity_score: Math.round(score * 100) / 100 });
      }
    }
    return results.sort((a, b) => b.similarity_score - a.similarity_score).slice(0, 5);
  }

  // ==================== ROOT CAUSE ANALYSIS ====================

  async analyzeRootCause(bug, relatedBugs) {
    if (this.provider !== 'heuristic') {
      try {
        return await this._analyzeRootCauseWithGemini(bug, relatedBugs);
      } catch (err) {
        console.error('Gemini root cause failed, using heuristics:', err.message);
      }
    }
    return this._analyzeRootCauseHeuristic(bug, relatedBugs);
  }

  async _analyzeRootCauseWithGemini(bug, relatedBugs) {
    const relatedList = relatedBugs.slice(0, 20).map(b =>
      `[${b.bug_key}] ${b.title} | ${b.status} | ${b.severity} | ${b.environment || 'N/A'}`
    ).join('\n');

    const prompt = `אתה מומחה QA לניתוח שורש בעיה (Root Cause Analysis).

באג לניתוח:
מזהה: ${bug.bug_key}
כותרת: ${bug.title}
תיאור: ${bug.description || 'אין'}
צעדים לשחזור: ${bug.steps_to_reproduce || 'אין'}
סביבה: ${bug.environment || 'לא צוין'}
חומרה: ${bug.severity}
עדיפות: ${bug.priority}

באגים קשורים בפרויקט:
${relatedList || 'אין באגים קשורים'}

נתח את הבאג וספק:
1. rootCause - סיבת השורש הסבירה (בעברית)
2. suggestedFix - המלצה לתיקון (בעברית)
3. confidence - רמת ביטחון (0.0-1.0)
4. relatedPatterns - דפוסים שזוהו

החזר JSON:
{
  "rootCause": "...",
  "suggestedFix": "...",
  "confidence": 0.75,
  "relatedPatterns": ["..."]
}`;

    const result = await this._callGemini(prompt, { temperature: 0.3 });

    return {
      rootCause: result.rootCause || 'לא ניתן לזהות סיבת שורש',
      suggestedFix: result.suggestedFix || 'נדרשת חקירה ידנית',
      relatedBugIds: relatedBugs.filter(b => {
        const bugWords = this._tokenize(bug.title);
        const relWords = this._tokenize(b.title);
        return this._jaccardSimilarity(bugWords, relWords) > 0.15;
      }).map(b => b.id),
      confidence: result.confidence || 0.7,
      relatedPatterns: result.relatedPatterns || [],
      model: `gemini/${this.geminiModel}`
    };
  }

  _analyzeRootCauseHeuristic(bug, relatedBugs) {
    const patterns = [];
    const envPattern = relatedBugs.filter(b => b.environment === bug.environment).length;
    if (envPattern > 2) patterns.push(`Multiple bugs in "${bug.environment}" environment suggest environment-specific issue`);

    const componentBugs = relatedBugs.filter(b => {
      const bugWords = this._tokenize(bug.title);
      const relWords = this._tokenize(b.title);
      return this._jaccardSimilarity(bugWords, relWords) > 0.2;
    });
    if (componentBugs.length > 1) patterns.push(`${componentBugs.length} related bugs found in similar component area`);

    const severityClusters = {};
    relatedBugs.forEach(b => { severityClusters[b.severity] = (severityClusters[b.severity] || 0) + 1; });

    return {
      rootCause: patterns.length > 0
        ? `Potential root causes identified:\n${patterns.map((p, i) => `${i + 1}. ${p}`).join('\n')}`
        : 'Insufficient data for automated root cause analysis. Manual investigation recommended.',
      suggestedFix: this._suggestFix(bug),
      relatedBugIds: componentBugs.map(b => b.id),
      confidence: patterns.length > 0 ? Math.min(0.3 + patterns.length * 0.15, 0.85) : 0.1,
      severityDistribution: severityClusters
    };
  }

  // ==================== RISK PREDICTION ====================

  async predictRisks(bugs, testResults) {
    const metrics = this._calculateRiskMetrics(bugs, testResults);

    if (this.provider !== 'heuristic') {
      try {
        return await this._predictRisksWithGemini(bugs, testResults, metrics);
      } catch (err) {
        console.error('Gemini risk prediction failed, using heuristics:', err.message);
      }
    }
    return this._predictRisksHeuristic(metrics);
  }

  async _predictRisksWithGemini(bugs, testResults, metrics) {
    const bugSummary = bugs.slice(0, 30).map(b => `[${b.priority}/${b.severity}] ${b.title} (${b.status})`).join('\n');

    const prompt = `אתה מומחה QA שמנתח סיכוני פרויקט.

נתוני הפרויקט:
- באגים פתוחים: ${metrics.totalOpenBugs}
- באגים קריטיים פתוחים: ${metrics.criticalOpenBugs}
- באגים חדשים ב-7 ימים אחרונים: ${metrics.recentBugRate}
- סה"כ תוצאות בדיקה: ${testResults.length}

באגים אחרונים:
${bugSummary || 'אין'}

נתח את רמת הסיכון וספק:
1. overallRiskLevel: "low" / "medium" / "high" / "critical"
2. analysis: ניתוח מפורט בעברית
3. recommendations: רשימת המלצות בעברית

החזר JSON:
{
  "overallRiskLevel": "...",
  "analysis": "...",
  "recommendations": ["..."]
}`;

    const result = await this._callGemini(prompt, { temperature: 0.3 });

    return {
      overallRiskLevel: result.overallRiskLevel || metrics.riskLevel,
      highRiskAreas: metrics.highRiskAreas,
      metrics: { recentBugRate: metrics.recentBugRate, criticalOpenBugs: metrics.criticalOpenBugs, totalOpenBugs: metrics.totalOpenBugs },
      analysis: result.analysis,
      recommendations: result.recommendations || this._generateRecommendations(metrics.riskLevel, metrics.highRiskAreas, metrics.criticalOpenBugs),
      model: `gemini/${this.geminiModel}`
    };
  }

  _calculateRiskMetrics(bugs, testResults) {
    const suiteFailureRates = {};
    testResults.forEach(tr => {
      if (!suiteFailureRates[tr.suite_name]) suiteFailureRates[tr.suite_name] = { total: 0, failed: 0 };
      suiteFailureRates[tr.suite_name].total++;
      if (tr.outcome === 'failed') suiteFailureRates[tr.suite_name].failed++;
    });

    const highRiskAreas = Object.entries(suiteFailureRates)
      .map(([name, data]) => ({ area: name, failureRate: data.total > 0 ? data.failed / data.total : 0, totalTests: data.total, failedTests: data.failed }))
      .filter(a => a.failureRate > 0.2)
      .sort((a, b) => b.failureRate - a.failureRate);

    const recentBugRate = bugs.filter(b => {
      const created = new Date(b.created_at);
      const weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate() - 7);
      return created > weekAgo;
    }).length;

    const criticalOpenBugs = bugs.filter(b => b.priority === 'critical' && !['closed', 'rejected', 'verified'].includes(b.status)).length;
    const totalOpenBugs = bugs.filter(b => !['closed', 'rejected', 'verified'].includes(b.status)).length;

    let riskLevel = 'low';
    if (criticalOpenBugs > 3 || recentBugRate > 10) riskLevel = 'critical';
    else if (criticalOpenBugs > 1 || recentBugRate > 5) riskLevel = 'high';
    else if (criticalOpenBugs > 0 || recentBugRate > 2) riskLevel = 'medium';

    return { highRiskAreas, recentBugRate, criticalOpenBugs, totalOpenBugs, riskLevel };
  }

  _predictRisksHeuristic(metrics) {
    return {
      overallRiskLevel: metrics.riskLevel,
      highRiskAreas: metrics.highRiskAreas,
      metrics: { recentBugRate: metrics.recentBugRate, criticalOpenBugs: metrics.criticalOpenBugs, totalOpenBugs: metrics.totalOpenBugs },
      recommendations: this._generateRecommendations(metrics.riskLevel, metrics.highRiskAreas, metrics.criticalOpenBugs)
    };
  }

  // ==================== HEURISTIC HELPERS ====================

  _isHebrew(text) {
    return /[\u0590-\u05FF]/.test(text);
  }

  _generateWithHeuristics(sourceType, content, options) {
    const isHeb = this._isHebrew(content);
    return isHeb ? this._generateHeuristicsHebrew(content, options) : this._generateHeuristicsEnglish(content, options);
  }

  _generateHeuristicsHebrew(content, options) {
    const tests = [];
    const lines = content.split('\n').filter(l => l.trim());
    let testCounter = 0;
    let currentSection = '';
    const traceMap = {};

    for (const line of lines) {
      const trimmed = line.trim();
      if (/^#{1,3}\s/.test(trimmed)) {
        currentSection = trimmed.replace(/^#+\s*/, '');
        continue;
      }

      const cleaned = trimmed.replace(/^[-*•]\s*/, '');
      if (cleaned.length < 5 || /^#{1,3}\s/.test(cleaned)) continue;
      if (!/[\u0590-\u05FF]/.test(cleaned) && cleaned.length < 10) continue;

      const isCritical = /חייב|אבטחה|אימות|סיסמ|נעיל|הרשא|קריטי|חובה/i.test(cleaned);
      const isImportant = /צריך|חשוב|מציג|תומך|שולח|מאפשר/i.test(cleaned);
      const priority = isCritical ? 1 : isImportant ? 2 : 3;

      const section = currentSection || 'כללי';
      const k = `AI-${String(++testCounter).padStart(3, '0')}`;

      tests.push({
        test_key: k,
        title: `${section} — ${cleaned}`,
        description: `בדיקה שהמערכת מיישמת נכון: ${cleaned}`,
        priority,
        type: 'manual',
        section,
        steps: this._generateHebrewSteps(cleaned, section)
      });

      if (!traceMap[section]) traceMap[section] = { requirement: section, testCases: [] };
      traceMap[section].testCases.push(k);

      const nk = `AI-${String(++testCounter).padStart(3, '0')}`;
      tests.push({
        test_key: nk,
        title: `${section} — בדיקה שלילית: ${cleaned}`,
        description: `בדיקת טיפול בשגיאות עבור: ${cleaned}`,
        priority: Math.min(priority + 1, 4),
        type: 'manual',
        section,
        steps: this._generateHebrewNegativeSteps(cleaned, section)
      });
      traceMap[section].testCases.push(nk);
    }

    if (options?.includeEdgeCases !== false) {
      tests.push({
        test_key: `AI-${String(++testCounter).padStart(3, '0')}`,
        title: 'בדיקת קצה — עומס נתונים מקסימלי',
        description: 'בדיקה שהמערכת מתמודדת עם כמות גדולה מאוד של נתונים',
        priority: 3, type: 'manual', section: 'בדיקות קצה',
        steps: [
          { action: 'טעינת כמות מקסימלית של נתונים למערכת', expected_result: 'המערכת מתפקדת ללא שגיאות' },
          { action: 'ביצוע חיפוש וסינון על מאגר גדול', expected_result: 'תוצאות מוחזרות בזמן סביר' },
          { action: 'בדיקת ביצועי עמוד עם נתונים רבים', expected_result: 'אין האטה משמעותית בטעינה' }
        ]
      });
      tests.push({
        test_key: `AI-${String(++testCounter).padStart(3, '0')}`,
        title: 'בדיקת קצה — גישה בו-זמנית של משתמשים',
        description: 'בדיקה שהמערכת מתמודדת עם גישה מקבילית',
        priority: 2, type: 'manual', section: 'בדיקות קצה',
        steps: [
          { action: 'פתיחת מספר חלונות דפדפן עם משתמשים שונים', expected_result: 'כל המשתמשים נכנסים בהצלחה' },
          { action: 'ביצוע פעולות בו-זמנית על אותו רשומה', expected_result: 'אין שיבוש נתונים' },
          { action: 'בדיקת נעילת רשומות בעריכה מקבילית', expected_result: 'המערכת מונעת התנגשויות' }
        ]
      });
      tests.push({
        test_key: `AI-${String(++testCounter).padStart(3, '0')}`,
        title: 'בדיקת אבטחה — הרשאות גישה',
        description: 'בדיקה שמשתמש ללא הרשאה לא יכול לבצע פעולות אסורות',
        priority: 1, type: 'manual', section: 'אבטחה',
        steps: [
          { action: 'ניסיון גישה לעמודים מוגבלים ללא הרשאה', expected_result: 'המערכת חוסמת גישה ומציגה הודעה מתאימה' },
          { action: 'ניסיון שינוי URL ישיר לעמוד ניהול', expected_result: 'הפניה לדף התחברות או דף שגיאה' },
          { action: 'ניסיון שליחת API ישיר ללא טוקן', expected_result: 'החזרת שגיאת 401 Unauthorized' }
        ]
      });
    }

    const traceabilityMatrix = Object.values(traceMap);
    return { tests, traceabilityMatrix, model: 'heuristic-v1-he', confidence: 0.70, totalGenerated: tests.length };
  }

  _generateHebrewSteps(requirement, section) {
    const steps = [];
    const lower = requirement.toLowerCase();

    if (/התחבר|כניסה|לוגין|אימות|סיסמ/i.test(lower)) {
      steps.push({ action: 'ניווט לדף ההתחברות', expected_result: 'דף ההתחברות נטען בהצלחה' });
      steps.push({ action: `ביצוע: ${requirement}`, expected_result: 'הפעולה מתבצעת ללא שגיאות' });
      steps.push({ action: 'אימות שהמשתמש מחובר ורואה את המסך הראשי', expected_result: 'המשתמש מנותב לדף הבית בהצלחה' });
    } else if (/חיפוש|סינון|מסנן|filter/i.test(lower)) {
      steps.push({ action: `ניווט לאזור ה${section}`, expected_result: 'העמוד נטען ומציג נתונים' });
      steps.push({ action: `ביצוע: ${requirement}`, expected_result: 'תוצאות מתעדכנות בהתאם לחיפוש/סינון' });
      steps.push({ action: 'אימות שהתוצאות תואמות את הקריטריון', expected_result: 'רק תוצאות רלוונטיות מוצגות' });
      steps.push({ action: 'ניקוי החיפוש/סינון', expected_result: 'כל הנתונים מוצגים מחדש' });
    } else if (/יצירת|הוספת|הוסף|ליצור|חדש/i.test(lower)) {
      steps.push({ action: `ניווט לאזור ה${section}`, expected_result: 'העמוד נטען בהצלחה' });
      steps.push({ action: 'לחיצה על כפתור יצירה/הוספה', expected_result: 'טופס יצירה נפתח' });
      steps.push({ action: 'מילוי כל השדות הנדרשים בנתונים תקינים', expected_result: 'כל השדות מקבלים את הערכים' });
      steps.push({ action: 'לחיצה על שמירה/אישור', expected_result: 'הרשומה נוצרת בהצלחה ומוצגת ברשימה' });
    } else if (/עריכ|עדכון|שינוי/i.test(lower)) {
      steps.push({ action: `ניווט לאזור ה${section} ובחירת רשומה קיימת`, expected_result: 'פרטי הרשומה מוצגים' });
      steps.push({ action: 'לחיצה על כפתור עריכה', expected_result: 'טופס העריכה נפתח עם הנתונים הקיימים' });
      steps.push({ action: 'שינוי ערכים ושמירה', expected_result: 'הנתונים מתעדכנים בהצלחה' });
      steps.push({ action: 'אימות שהשינויים נשמרו', expected_result: 'הנתונים החדשים מוצגים נכון' });
    } else if (/מחיק|הסר|למחוק/i.test(lower)) {
      steps.push({ action: `ניווט לאזור ה${section} ובחירת רשומה`, expected_result: 'הרשומה מסומנת' });
      steps.push({ action: 'לחיצה על כפתור מחיקה', expected_result: 'הודעת אישור מוצגת' });
      steps.push({ action: 'אישור המחיקה', expected_result: 'הרשומה נמחקת ולא מופיעה ברשימה' });
    } else if (/מציג|הצגת|רשימ|דוח/i.test(lower)) {
      steps.push({ action: `ניווט לאזור ה${section}`, expected_result: 'העמוד נטען בהצלחה' });
      steps.push({ action: `אימות: ${requirement}`, expected_result: 'הנתונים מוצגים בצורה נכונה ומלאה' });
      steps.push({ action: 'בדיקת מיון ועימוד', expected_result: 'הנתונים ניתנים למיון ומוצגים בעימוד תקין' });
    } else if (/ייצוא|ייבוא|export|import|csv|excel/i.test(lower)) {
      steps.push({ action: `ניווט לאזור ה${section}`, expected_result: 'העמוד נטען' });
      steps.push({ action: `ביצוע: ${requirement}`, expected_result: 'תהליך הייצוא/ייבוא מתחיל' });
      steps.push({ action: 'בדיקת הקובץ שנוצר/נקלט', expected_result: 'הנתונים בקובץ תואמים לנתונים במערכת' });
    } else if (/שולח|מייל|התראה|הודעה/i.test(lower)) {
      steps.push({ action: `ביצוע הפעולה שמפעילה: ${requirement}`, expected_result: 'הפעולה מתבצעת בהצלחה' });
      steps.push({ action: 'בדיקת תיבת המייל / לוג ההודעות', expected_result: 'ההודעה/מייל נשלח עם תוכן נכון' });
      steps.push({ action: 'אימות שהנמען קיבל את ההודעה', expected_result: 'ההודעה הגיעה ליעד בזמן סביר' });
    } else if (/נעיל|חסימ|הגבל/i.test(lower)) {
      steps.push({ action: `ביצוע: ${requirement}`, expected_result: 'הנעילה/חסימה פועלת כמצופה' });
      steps.push({ action: 'ניסיון גישה לאחר הנעילה', expected_result: 'הגישה חסומה ומוצגת הודעה מתאימה' });
      steps.push({ action: 'שחרור הנעילה (אם רלוונטי) ובדיקת גישה חוזרת', expected_result: 'הגישה משוחררת בהצלחה' });
    } else {
      steps.push({ action: `ניווט לאזור ה${section}`, expected_result: 'העמוד נטען בהצלחה' });
      steps.push({ action: `ביצוע: ${requirement}`, expected_result: 'הפעולה מתבצעת ללא שגיאות' });
      steps.push({ action: 'אימות התוצאה הצפויה', expected_result: `${requirement} — עובד כמצופה` });
    }

    return steps;
  }

  _generateHebrewNegativeSteps(requirement, section) {
    const lower = requirement.toLowerCase();

    if (/התחבר|כניסה|סיסמ|אימות/i.test(lower)) {
      return [
        { action: 'ניסיון התחברות עם סיסמה שגויה', expected_result: 'הודעת שגיאה מוצגת, לא ניתן להיכנס' },
        { action: 'ניסיון התחברות עם שדות ריקים', expected_result: 'הודעת ולידציה מוצגת' },
        { action: 'ניסיון התחברות עם תווים מיוחדים / SQL Injection', expected_result: 'המערכת חוסמת ולא קורסת' }
      ];
    } else if (/יצירת|הוספת|ליצור|חדש/i.test(lower)) {
      return [
        { action: 'ניסיון יצירה עם שדות חובה ריקים', expected_result: 'הודעת ולידציה — לא ניתן לשמור' },
        { action: 'ניסיון יצירה עם נתונים לא תקינים (אותיות בשדה מספרי וכו\')', expected_result: 'הודעת שגיאה מתאימה' },
        { action: 'ניסיון יצירה כפולה (אם רלוונטי)', expected_result: 'המערכת מזהה כפילות ומתריעה' }
      ];
    } else if (/מחיק|הסר/i.test(lower)) {
      return [
        { action: 'ניסיון מחיקה של רשומה עם תלויות', expected_result: 'המערכת מונעת מחיקה ומסבירה למה' },
        { action: 'ביטול מחיקה בחלון האישור', expected_result: 'הרשומה לא נמחקת' },
        { action: 'ניסיון מחיקה ללא הרשאה מתאימה', expected_result: 'הודעת שגיאת הרשאה' }
      ];
    } else if (/ייצוא|ייבוא|csv|excel/i.test(lower)) {
      return [
        { action: 'ניסיון ייבוא קובץ בפורמט שגוי', expected_result: 'הודעת שגיאה — פורמט לא נתמך' },
        { action: 'ניסיון ייבוא קובץ ריק', expected_result: 'הודעה שאין נתונים לייבא' },
        { action: 'ניסיון ייבוא קובץ עם נתונים חסרים', expected_result: 'דוח שגיאות מפורט' }
      ];
    } else {
      return [
        { action: `ניווט לאזור ה${section} והזנת נתונים לא תקינים`, expected_result: 'הודעת ולידציה מוצגת' },
        { action: 'ניסיון ביצוע הפעולה ללא הרשאה מתאימה', expected_result: 'הגישה נחסמת' },
        { action: 'בדיקת יציבות המערכת לאחר שגיאה', expected_result: 'המערכת ממשיכה לפעול תקין' }
      ];
    }
  }

  _generateHeuristicsEnglish(content, options) {
    const tests = [];
    const lines = content.split('\n').filter(l => l.trim());
    let testCounter = 0;

    const features = lines.filter(l => /^[-*•]/.test(l.trim()) || /^#+\s/.test(l.trim()) || /should|must|can|allow|enable|display|show|support/i.test(l));

    features.forEach(feature => {
      const cleaned = feature.replace(/^[-*•#\s]+/, '').trim();
      if (cleaned.length < 5) return;

      testCounter++;
      tests.push({
        test_key: `AI-${String(testCounter).padStart(3, '0')}`,
        title: `Verify: ${cleaned}`,
        description: `Validate that the system correctly implements: ${cleaned}`,
        priority: /must|critical|security|auth/i.test(cleaned) ? 1 : /should|important/i.test(cleaned) ? 2 : 3,
        type: 'manual',
        steps: [
          { action: 'Navigate to the relevant feature area', expected_result: 'Page/section loads correctly' },
          { action: `Perform the action: ${cleaned}`, expected_result: 'Action completes without errors' },
          { action: 'Verify the expected outcome', expected_result: `${cleaned} works as specified` }
        ]
      });

      tests.push({
        test_key: `AI-${String(++testCounter).padStart(3, '0')}`,
        title: `Negative: ${cleaned} - Invalid input`,
        description: `Validate error handling for: ${cleaned}`,
        priority: 2, type: 'manual',
        steps: [
          { action: 'Navigate to the feature', expected_result: 'Page loads' },
          { action: 'Enter invalid/empty data', expected_result: 'Validation error shown' },
          { action: 'Verify system stability', expected_result: 'No crash, graceful error handling' }
        ]
      });
    });

    if (options?.includeEdgeCases !== false) {
      tests.push({ test_key: `AI-${String(++testCounter).padStart(3, '0')}`, title: 'Edge Case: Maximum data volume', priority: 3, type: 'manual', steps: [{ action: 'Load maximum data', expected_result: 'System handles gracefully' }] });
      tests.push({ test_key: `AI-${String(++testCounter).padStart(3, '0')}`, title: 'Edge Case: Concurrent users', priority: 2, type: 'manual', steps: [{ action: 'Simulate concurrent access', expected_result: 'No data corruption' }] });
    }

    const traceabilityMatrix = features.map(f => ({
      requirement: f.replace(/^[-*•#\s]+/, '').trim(),
      testCases: tests.filter(t => t.title.includes(f.replace(/^[-*•#\s]+/, '').trim().substring(0, 20))).map(t => t.test_key)
    })).filter(t => t.testCases.length > 0);

    return { tests, traceabilityMatrix, model: 'heuristic-v1', confidence: 0.65, totalGenerated: tests.length };
  }

  _suggestFix(bug) {
    const title = (bug.title || '').toLowerCase();
    if (/memory|leak|זיכרון/.test(title)) return 'Check for unsubscribed event listeners, unclosed connections, or growing data structures.';
    if (/crash|unresponsive|קריסה/.test(title)) return 'Check error boundaries, add try-catch blocks, verify null checks.';
    if (/slow|performance|איטי|ביצועים/.test(title)) return 'Profile the slow path, check for N+1 queries, add caching.';
    if (/login|auth|כניסה|הזדהות/.test(title)) return 'Verify token handling, check CORS settings, validate session management.';
    if (/display|render|ui|תצוגה/.test(title)) return 'Check CSS rules, viewport compatibility, and component rendering logic.';
    return 'Manual investigation needed. Check recent code changes in the affected area.';
  }

  _generateRecommendations(riskLevel, highRiskAreas, criticalBugs) {
    const recs = [];
    if (criticalBugs > 0) recs.push(`Prioritize fixing ${criticalBugs} critical open bugs before release`);
    if (highRiskAreas.length > 0) recs.push(`Focus regression testing on: ${highRiskAreas.map(a => a.area).join(', ')}`);
    if (riskLevel === 'critical') recs.push('Consider delaying release until critical issues are resolved');
    if (riskLevel === 'high') recs.push('Schedule additional test cycles for high-risk areas');
    if (recs.length === 0) recs.push('Current risk level is acceptable. Continue standard testing procedures.');
    return recs;
  }

  _tokenize(text) {
    return (text || '').toLowerCase().replace(/[^\w\s\u0590-\u05FF]/g, '').split(/\s+/).filter(w => w.length > 2);
  }

  _jaccardSimilarity(set1, set2) {
    const s1 = new Set(set1);
    const s2 = new Set(set2);
    const intersection = new Set([...s1].filter(x => s2.has(x)));
    const union = new Set([...s1, ...s2]);
    return union.size > 0 ? intersection.size / union.size : 0;
  }
}

module.exports = AIService;
