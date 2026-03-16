/**
 * AI QA Architect Engine — Enterprise-grade test generation system.
 * SYSTEM ROLE: QA ARCHITECT ENGINE
 * OUTPUT LANGUAGE: HEBREW (auto-detect)
 * TEST TYPE: MANUAL ONLY
 * DETAIL LEVEL: MAXIMUM
 *
 * 10-Stage Pipeline:
 *  1. Spec Analysis  2. Module Decomposition  3. Test Scenarios
 *  4. Detailed Test Cases  5. Negative Testing  6. Edge Cases
 *  7. UX Testing  8. Data Testing  9. Spec Gap Analysis  10. Coverage Matrix
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
      model: this.provider === 'gemini' ? this.geminiModel : this.provider === 'openai' ? 'gpt-4o' : 'qa-architect-v2',
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
    try { return JSON.parse(text); } catch { return { raw: text }; }
  }

  // ==================== TEST GENERATION ====================

  async generateTests(sourceType, content, options = {}) {
    if (this.provider !== 'heuristic') {
      return this._generateWithGemini(sourceType, content, options);
    }
    return this._generateWithArchitectEngine(content, options);
  }

  buildProjectContextBlock(projectContext) {
    if (!projectContext || !projectContext.trim()) return '';
    const truncated = projectContext.substring(0, 4000);
    return `
=== PROJECT KNOWLEDGE BASE ===
The following is background information about the project being tested.
Use this context to generate more accurate, relevant, and domain-specific test cases.
---
${truncated}
---
=== END PROJECT KNOWLEDGE ===
`;
  }

  async _generateWithGemini(sourceType, content, options) {
    const isHeb = this._isHebrew(content);
    const langInstruction = isHeb
      ? 'כתוב את כל התסריטים בעברית מקצועית. כל השדות חייבים להיות בעברית.'
      : 'Write all test cases in English.';

    const sourceLabel = {
      prd: 'PRD (Product Requirements Document)',
      user_story: 'User Stories',
      api_spec: 'API Specification',
      technical_doc: 'Technical Document',
      free_text: 'Requirements Description',
      jira_issues: 'Jira Issues (User Stories / Epics / Tasks)'
    }[sourceType] || 'Requirements';

    const projectContextBlock = this.buildProjectContextBlock(options.projectContext || '');

    const prompt = `SYSTEM ROLE: QA ARCHITECT ENGINE
OUTPUT LANGUAGE: ${isHeb ? 'HEBREW' : 'ENGLISH'}
TEST TYPE: MANUAL ONLY
DETAIL LEVEL: MAXIMUM

אתה AI QA Architect בכיר עם ניסיון של מעל 15 שנה בתכנון בדיקות תוכנה למערכות מורכבות.
יש לך מומחיות ב: Manual QA, Test Architecture, Test Design Techniques, Web, Mobile, Backend, API, Databases, Enterprise Systems.

${langInstruction}

${projectContextBlock}

קיבלת ${sourceLabel}:
---
${content}
---

בצע את כל 10 השלבים:

שלב 1 — ניתוח האפיון: זהה פיצ'רים, דרישות פונקציונליות ולא-פונקציונליות, זרימות, אינטגרציות, נקודות סיכון.
שלב 2 — פירוק למודולים לוגיים.
שלב 3 — יצירת Test Scenarios לכל מודול.
שלב 4 — יצירת Test Cases ידניים מלאים עם סטפים מפורטים מאוד.
שלב 5 — בדיקות שליליות: נתונים שגויים, שדות ריקים, קלט לא חוקי, הרשאות לא מתאימות.
שלב 6 — Edge Cases: גבולות, תאריכים, נתונים חריגים, פעולות כפולות, עומס.
שלב 7 — בדיקות UX: הודעות שגיאה, כפתורים, ניווט, אחידות UI.
שלב 8 — בדיקות נתונים: שמירה, עדכון, מחיקה, עקביות.
שלב 9 — זיהוי חורים באפיון (missing requirements).
שלב 10 — מטריצת כיסוי.

חשוב: חשוב כמו בודק שמנסה לשבור את המערכת.

עבור כל Test Case, ספק steps מפורטים מאוד ברמה שמאפשרת לכל בודק לבצע ללא ידע מוקדם.
כל step חייב לכלול action ספציפי ו-expected_result ספציפי.

חשוב מאוד — לכל תסריט הוסף שדה assigned_role שמציין מי צריך לבצע את הבדיקה:
- "qa_lead" — ראש צוות QA: בדיקות אדריכליות, review תהליכים, בדיקות אינטגרציה מורכבות, אישור תרחישי Edge Case קריטיים, בדיקות אבטחה, review מטריצת כיסוי
- "senior_tester" — בודק בכיר: בדיקות שליליות מורכבות, בדיקות ביצועים, בדיקות E2E, edge cases, בדיקות נתונים
- "tester" — בודק תוכנה: בדיקות פונקציונליות רגילות, בדיקות UX בסיסיות, בדיקות חיוביות, בדיקות ממשק

החזר JSON בפורמט:
{
  "specAnalysis": {
    "features": ["..."],
    "functionalReqs": ["..."],
    "nonFunctionalReqs": ["..."],
    "userFlows": ["..."],
    "integrations": ["..."],
    "riskPoints": ["..."]
  },
  "modules": [
    { "name": "...", "description": "..." }
  ],
  "tests": [
    {
      "test_key": "TC-001",
      "module": "...",
      "title": "...",
      "description": "...",
      "preconditions": "...",
      "assigned_role": "tester|senior_tester|qa_lead",
      "priority": 1,
      "severity": "critical",
      "type": "manual",
      "category": "functional|negative|edge_case|ux|data|security",
      "steps": [
        { "step": 1, "action": "...", "expected_result": "..." }
      ],
      "test_data": "..."
    }
  ],
  "missingRequirements": [
    { "requirement": "...", "impact": "...", "recommendation": "..." }
  ],
  "traceabilityMatrix": [
    { "requirement": "...", "testCases": ["TC-001"] }
  ],
  "summary": {
    "totalTests": 0,
    "byCategory": { "functional": 0, "negative": 0, "edge_case": 0, "ux": 0, "data": 0, "security": 0 },
    "byPriority": { "critical": 0, "high": 0, "medium": 0, "low": 0 }
  }
}`;

    try {
      const result = await this._callGemini(prompt, { temperature: 0.4, maxTokens: 8192 });
      const tests = result.tests || [];
      return {
        tests,
        specAnalysis: result.specAnalysis || null,
        modules: result.modules || [],
        missingRequirements: result.missingRequirements || [],
        traceabilityMatrix: result.traceabilityMatrix || [],
        summary: result.summary || null,
        model: `gemini/${this.geminiModel}`,
        confidence: 0.92,
        totalGenerated: tests.length
      };
    } catch (err) {
      console.error('Gemini failed, falling back to QA Architect engine:', err.message);
      const fallback = this._generateWithArchitectEngine(content, options);
      fallback.model = `qa-architect-v2 (Gemini fallback: ${err.message})`;
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

  // ==================== QA ARCHITECT ENGINE (10-Stage Pipeline) ====================

  _isHebrew(text) {
    const hebChars = (text.match(/[\u0590-\u05FF]/g) || []).length;
    return hebChars > 5;
  }

  _generateWithArchitectEngine(content, options) {
    const isHeb = this._isHebrew(content);
    if (!isHeb) return this._generateArchitectEnglish(content, options);

    const stage1 = this._stage1_analyzeSpec(content);
    const stage2 = this._stage2_decomposeModules(stage1);
    const stage9 = this._stage9_findGaps(stage1, stage2);
    const allTests = [];
    let tc = 0;
    const traceMap = {};

    for (const mod of stage2) {
      const stage3_scenarios = this._stage3_createScenarios(mod, stage1);

      for (const scenario of stage3_scenarios) {
        const testId = `TC-${String(++tc).padStart(3, '0')}`;
        allTests.push({
          test_key: testId,
          module: mod.name,
          title: scenario.title,
          description: scenario.description,
          preconditions: scenario.preconditions || `המשתמש מחובר למערכת ונמצא במודול ${mod.name}`,
          assigned_role: scenario.priority === 1 ? 'senior_tester' : 'tester',
          priority: scenario.priority,
          severity: scenario.priority === 1 ? 'critical' : scenario.priority === 2 ? 'major' : 'minor',
          type: 'manual',
          category: 'functional',
          section: mod.name,
          steps: scenario.steps,
          test_data: scenario.testData || ''
        });
        if (!traceMap[mod.name]) traceMap[mod.name] = { requirement: mod.name, testCases: [] };
        traceMap[mod.name].testCases.push(testId);
      }

      const stage5_negative = this._stage5_negativeTests(mod, stage1);
      for (const neg of stage5_negative) {
        const testId = `TC-${String(++tc).padStart(3, '0')}`;
        allTests.push({
          test_key: testId, module: mod.name,
          title: `[שלילי] ${neg.title}`,
          description: neg.description,
          preconditions: neg.preconditions || `המשתמש מחובר למערכת`,
          assigned_role: neg.priority === 1 ? 'qa_lead' : 'senior_tester',
          priority: neg.priority, severity: neg.priority <= 2 ? 'major' : 'minor',
          type: 'manual', category: 'negative', section: mod.name,
          steps: neg.steps, test_data: neg.testData || ''
        });
        if (traceMap[mod.name]) traceMap[mod.name].testCases.push(testId);
      }

      const stage6_edge = this._stage6_edgeCases(mod, stage1);
      for (const edge of stage6_edge) {
        const testId = `TC-${String(++tc).padStart(3, '0')}`;
        allTests.push({
          test_key: testId, module: mod.name,
          title: `[קצה] ${edge.title}`,
          description: edge.description,
          preconditions: edge.preconditions || 'המשתמש מחובר למערכת',
          assigned_role: 'senior_tester',
          priority: edge.priority, severity: 'major',
          type: 'manual', category: 'edge_case', section: mod.name,
          steps: edge.steps, test_data: edge.testData || ''
        });
        if (traceMap[mod.name]) traceMap[mod.name].testCases.push(testId);
      }
    }

    const stage7_ux = this._stage7_uxTests(stage1, stage2);
    for (const ux of stage7_ux) {
      const testId = `TC-${String(++tc).padStart(3, '0')}`;
      allTests.push({
        test_key: testId, module: 'חווית משתמש',
        title: `[UX] ${ux.title}`, description: ux.description,
        preconditions: 'המשתמש מחובר למערכת',
        assigned_role: 'tester',
        priority: ux.priority, severity: 'minor',
        type: 'manual', category: 'ux', section: 'חווית משתמש (UX)',
        steps: ux.steps, test_data: ''
      });
    }

    const stage8_data = this._stage8_dataTests(stage1, stage2);
    for (const dt of stage8_data) {
      const testId = `TC-${String(++tc).padStart(3, '0')}`;
      allTests.push({
        test_key: testId, module: 'בדיקות נתונים',
        title: `[DATA] ${dt.title}`, description: dt.description,
        preconditions: 'קיימים נתונים במערכת',
        assigned_role: 'senior_tester',
        priority: dt.priority, severity: 'major',
        type: 'manual', category: 'data', section: 'בדיקות נתונים',
        steps: dt.steps, test_data: dt.testData || ''
      });
    }

    const securityTests = this._generateSecurityTests(stage1);
    for (const sec of securityTests) {
      const testId = `TC-${String(++tc).padStart(3, '0')}`;
      allTests.push({
        test_key: testId, module: 'אבטחה',
        title: `[אבטחה] ${sec.title}`, description: sec.description,
        preconditions: sec.preconditions || 'המשתמש מחובר למערכת',
        assigned_role: 'qa_lead',
        priority: 1, severity: 'critical',
        type: 'manual', category: 'security', section: 'אבטחה',
        steps: sec.steps, test_data: ''
      });
    }

    const byCategory = { functional: 0, negative: 0, edge_case: 0, ux: 0, data: 0, security: 0 };
    const byPriority = { critical: 0, high: 0, medium: 0, low: 0 };
    allTests.forEach(t => {
      byCategory[t.category] = (byCategory[t.category] || 0) + 1;
      if (t.priority === 1) byPriority.critical++;
      else if (t.priority === 2) byPriority.high++;
      else if (t.priority === 3) byPriority.medium++;
      else byPriority.low++;
    });

    return {
      tests: allTests,
      specAnalysis: stage1,
      modules: stage2.map(m => ({ name: m.name, description: m.description })),
      missingRequirements: stage9,
      traceabilityMatrix: Object.values(traceMap),
      summary: { totalTests: allTests.length, byCategory, byPriority },
      model: 'qa-architect-v2',
      confidence: 0.82,
      totalGenerated: allTests.length
    };
  }

  // --- Stage 1: Analyze Specification ---
  _stage1_analyzeSpec(content) {
    const lines = content.split('\n').map(l => l.trim()).filter(Boolean);
    const features = [];
    const functionalReqs = [];
    const nonFunctionalReqs = [];
    const userFlows = [];
    const integrations = [];
    const riskPoints = [];
    const sections = [];
    let currentSection = '';

    for (const line of lines) {
      if (/^\d+\.\s+|^#{1,3}\s/.test(line)) {
        currentSection = line.replace(/^\d+\.\s+|^#+\s*/, '').trim();
        sections.push(currentSection);
        continue;
      }
      const cl = line.replace(/^[-*•]\s*/, '');
      if (cl.length < 5) continue;

      if (/ממשק|אינטגרציה|חיבור|API|webhook|מערכת.*חיצונית|AMF|GP|נפ"ע|מפנה/i.test(cl)) {
        integrations.push(cl);
      }
      if (/ביצועים|זמן תגובה|עומס|SLA|נפח|סקייל/i.test(cl)) {
        nonFunctionalReqs.push(cl);
      }
      if (/סיכון|חשש|כשל|קריטי|זהירות|אזהרה|שגיאה|באג/i.test(cl)) {
        riskPoints.push(cl);
      }
      if (/זרימ|תהליך|תרחיש|שלב|ביצוע|flow/i.test(cl)) {
        userFlows.push(cl);
      }
      if (/חייב|צריך|נדרש|יש ל|מאפשר|מציג|תומך|מעביר|מחשב|שולח|מוחק|יוצר/i.test(cl)) {
        functionalReqs.push(cl);
        features.push({ text: cl, section: currentSection });
      } else if (cl.length > 15 && /[\u0590-\u05FF]/.test(cl)) {
        features.push({ text: cl, section: currentSection });
      }
    }

    if (riskPoints.length === 0) {
      if (integrations.length > 2) riskPoints.push('מספר רב של אינטגרציות מגדיל סיכון לכשלים');
      if (functionalReqs.length > 10) riskPoints.push('כמות דרישות גדולה — סיכון לחוסר כיסוי בדיקות');
      riskPoints.push('יש לוודא טיפול נכון בשגיאות בכל הממשקים');
    }

    return { features, functionalReqs, nonFunctionalReqs, userFlows, integrations, riskPoints, sections };
  }

  // --- Stage 2: Decompose into Modules ---
  _stage2_decomposeModules(analysis) {
    const moduleMap = {};
    for (const feat of analysis.features) {
      const sec = feat.section || 'כללי';
      if (!moduleMap[sec]) moduleMap[sec] = { name: sec, description: `מודול ${sec}`, features: [], reqs: [] };
      moduleMap[sec].features.push(feat.text);
    }
    for (const req of analysis.functionalReqs) {
      for (const mod of Object.values(moduleMap)) {
        if (mod.features.some(f => this._textOverlap(f, req) > 0.3)) {
          mod.reqs.push(req);
          break;
        }
      }
    }
    if (analysis.integrations.length > 0) {
      moduleMap['ממשקים ואינטגרציות'] = moduleMap['ממשקים ואינטגרציות'] || {
        name: 'ממשקים ואינטגרציות', description: 'בדיקת כלל הממשקים והאינטגרציות', features: analysis.integrations, reqs: []
      };
    }
    const modules = Object.values(moduleMap).filter(m => m.features.length > 0);
    if (modules.length === 0) {
      modules.push({ name: 'כללי', description: 'דרישות כלליות', features: analysis.functionalReqs.slice(0, 10), reqs: analysis.functionalReqs });
    }
    return modules;
  }

  // --- Stage 3: Create Test Scenarios ---
  _stage3_createScenarios(mod, analysis) {
    const scenarios = [];
    for (const feat of mod.features) {
      const priority = this._assessPriority(feat);
      const steps = this._buildDetailedSteps(feat, mod.name);
      scenarios.push({
        title: `אימות: ${this._shortenText(feat, 80)}`,
        description: `בדיקה שהמערכת מיישמת נכון את הדרישה: ${feat}`,
        priority,
        preconditions: this._buildPreconditions(feat, mod.name),
        steps,
        testData: this._suggestTestData(feat)
      });
    }
    return scenarios;
  }

  // --- Stage 5: Negative Tests ---
  _stage5_negativeTests(mod, analysis) {
    const negatives = [];
    for (const feat of mod.features) {
      const lower = feat;
      if (/מעביר|שולח|שומר|מחשב|מציג|מעדכן|יוצר|טוען|נטען/i.test(lower)) {
        negatives.push({
          title: `כשל בתהליך: ${this._shortenText(feat, 60)}`,
          description: `בדיקה שהמערכת מטפלת נכון כאשר התהליך נכשל`,
          priority: 2,
          preconditions: `המשתמש מחובר למערכת, מודול ${mod.name}`,
          steps: [
            { step: 1, action: `ניווט לאזור ${mod.name} במערכת`, expected_result: 'העמוד/מסך נטען בהצלחה' },
            { step: 2, action: 'הזנת נתונים חלקיים — השארת שדות חובה ריקים', expected_result: 'המערכת מציגה הודעת ולידציה ברורה ומדויקת' },
            { step: 3, action: 'הזנת נתונים בפורמט שגוי (אותיות במקום מספרים, תאריך לא תקין)', expected_result: 'המערכת דוחה את הקלט ומציגה הודעה מתאימה' },
            { step: 4, action: 'ניסיון שמירה/שליחה עם נתונים לא חוקיים', expected_result: 'הפעולה נדחית, הנתונים לא נשמרים, המערכת יציבה' },
            { step: 5, action: 'אימות שלא נשמר מידע שגוי בבסיס הנתונים', expected_result: 'אין רשומות שגויות במערכת' }
          ],
          testData: 'נתונים לא תקינים: שדות ריקים, פורמטים שגויים, ערכים חורגים'
        });
      }
      if (/הרשא|גישה|משתמש|תפקיד/i.test(lower)) {
        negatives.push({
          title: `הרשאות לא מורשות: ${this._shortenText(feat, 60)}`,
          description: 'בדיקה שמשתמש ללא הרשאה מתאימה לא יכול לבצע את הפעולה',
          priority: 1,
          steps: [
            { step: 1, action: 'התחברות למערכת עם משתמש בעל הרשאות מוגבלות', expected_result: 'המשתמש מתחבר בהצלחה' },
            { step: 2, action: `ניסיון גישה לפונקציונליות: ${this._shortenText(feat, 40)}`, expected_result: 'המערכת חוסמת את הגישה' },
            { step: 3, action: 'אימות הצגת הודעת שגיאה מתאימה', expected_result: 'מוצגת הודעה "אין הרשאה" או דומה' },
            { step: 4, action: 'ניסיון גישה ישירה דרך URL/API', expected_result: 'הגישה נחסמת גם בגישה ישירה' }
          ]
        });
      }
    }
    if (negatives.length === 0 && mod.features.length > 0) {
      negatives.push({
        title: `קלט לא תקין במודול ${mod.name}`,
        description: `בדיקת התנהגות המודול עם נתונים שגויים ומצבי שגיאה`,
        priority: 2,
        steps: [
          { step: 1, action: `ניווט למודול ${mod.name}`, expected_result: 'המודול נטען בהצלחה' },
          { step: 2, action: 'הזנת ערכים ריקים בכל שדות הקלט', expected_result: 'הודעות ולידציה מוצגות לכל שדה חובה' },
          { step: 3, action: 'הזנת תווים מיוחדים (<script>, SQL injection)', expected_result: 'המערכת מסננת קלט מסוכן' },
          { step: 4, action: 'הזנת ערכים חורגים (מספרים שליליים, טקסט ארוך מאוד)', expected_result: 'המערכת מגבילה את הקלט ומציגה הודעה' }
        ]
      });
    }
    return negatives;
  }

  // --- Stage 6: Edge Cases ---
  _stage6_edgeCases(mod, analysis) {
    const edges = [];
    const hasNumeric = mod.features.some(f => /סכום|מספר|כמות|ערך|מחיר|תמורה|יתרה|חישוב/i.test(f));
    const hasDate = mod.features.some(f => /תאריך|יום|מועד|זמן|לילה|בוקר/i.test(f));
    const hasList = mod.features.some(f => /רשימ|טבל|תנועות|פעולות|נתונים/i.test(f));

    if (hasNumeric) {
      edges.push({
        title: `ערכי גבול מספריים — ${mod.name}`,
        description: 'בדיקת ערכי מינימום, מקסימום, אפס וערכים שליליים',
        priority: 2,
        steps: [
          { step: 1, action: `ניווט למודול ${mod.name}`, expected_result: 'המודול נטען בהצלחה' },
          { step: 2, action: 'הזנת ערך 0 בשדה מספרי', expected_result: 'המערכת מטפלת בערך אפס בצורה נכונה' },
          { step: 3, action: 'הזנת ערך שלילי', expected_result: 'המערכת מציגה הודעת שגיאה או מטפלת בהתאם ללוגיקה העסקית' },
          { step: 4, action: 'הזנת ערך מקסימלי (999999999)', expected_result: 'המערכת מטפלת ללא overflow או שגיאה' },
          { step: 5, action: 'הזנת מספר עם נקודה עשרונית ארוכה (0.123456789)', expected_result: 'המערכת מעגלת בהתאם לכללים העסקיים' }
        ],
        testData: 'ערכים: 0, -1, 999999999, 0.123456789, ריק'
      });
    }
    if (hasDate) {
      edges.push({
        title: `תאריכים חריגים — ${mod.name}`,
        description: 'בדיקת מקרי קצה בתאריכים',
        priority: 2,
        steps: [
          { step: 1, action: 'הזנת תאריך עתידי רחוק (שנה 2099)', expected_result: 'המערכת מטפלת בהתאם' },
          { step: 2, action: 'הזנת תאריך עבר רחוק (שנה 1900)', expected_result: 'המערכת מציגה הודעה או מטפלת' },
          { step: 3, action: 'הזנת 29 בפברואר בשנה לא מעוברת', expected_result: 'המערכת דוחה את התאריך' },
          { step: 4, action: 'בדיקת פעולה בחצות (00:00)', expected_result: 'אין בעיות בחישובי תאריך' },
          { step: 5, action: 'בדיקת מעבר בין ימי עסקים (שישי-ראשון)', expected_result: 'המערכת מטפלת בימים שאינם ימי עסקים' }
        ],
        testData: 'תאריכים: 29/02/2025, 01/01/1900, 31/12/2099, 00:00:00'
      });
    }
    if (hasList) {
      edges.push({
        title: `עומס נתונים — ${mod.name}`,
        description: 'בדיקת התנהגות עם כמויות גדולות של נתונים',
        priority: 3,
        steps: [
          { step: 1, action: 'טעינת מסך עם 0 רשומות (מצב ריק)', expected_result: 'מוצגת הודעה "אין נתונים להצגה" ולא שגיאה' },
          { step: 2, action: 'טעינת מסך עם רשומה בודדת', expected_result: 'הרשומה מוצגת בצורה תקינה' },
          { step: 3, action: 'טעינת מסך עם 1000+ רשומות', expected_result: 'עימוד עובד, אין האטה משמעותית' },
          { step: 4, action: 'גלילה מהירה ברשימה ארוכה', expected_result: 'אין קריסות או פריקת תוכן' }
        ]
      });
    }
    if (edges.length === 0) {
      edges.push({
        title: `מקרי קצה כלליים — ${mod.name}`,
        description: 'בדיקת מצבים חריגים במודול',
        priority: 3,
        steps: [
          { step: 1, action: 'ביצוע פעולה פעמיים ברציפות (double click/submit)', expected_result: 'הפעולה מתבצעת פעם אחת בלבד' },
          { step: 2, action: 'ניתוק רשת באמצע פעולה', expected_result: 'הודעת שגיאה מתאימה, אין אובדן נתונים' },
          { step: 3, action: 'רענון דף (F5) באמצע תהליך', expected_result: 'המערכת חוזרת למצב יציב' },
          { step: 4, action: 'לחיצה על כפתור "חזור" בדפדפן', expected_result: 'ניווט תקין ללא שגיאות' }
        ]
      });
    }
    return edges;
  }

  // --- Stage 7: UX Tests ---
  _stage7_uxTests(analysis, modules) {
    const tests = [];
    tests.push({
      title: 'הודעות שגיאה — בהירות ודיוק',
      description: 'בדיקה שכל הודעות השגיאה ברורות, בעברית, ומנחות את המשתמש',
      priority: 3,
      steps: [
        { step: 1, action: 'גרימת שגיאת ולידציה (שדה חובה ריק)', expected_result: 'הודעת שגיאה ברורה בעברית ליד השדה הרלוונטי' },
        { step: 2, action: 'גרימת שגיאת שרת (אם אפשר)', expected_result: 'הודעת שגיאה ידידותית למשתמש, לא הודעת מערכת טכנית' },
        { step: 3, action: 'בדיקה שהודעות השגיאה לא חושפות מידע טכני', expected_result: 'אין חשיפת stack trace, SQL, או מידע רגיש' }
      ]
    });
    tests.push({
      title: 'ניווט ותזוזה במערכת',
      description: 'בדיקה שהניווט במערכת אינטואיטיבי ועקבי',
      priority: 3,
      steps: [
        { step: 1, action: 'מעבר בין כל המסכים/תפריטים הראשיים', expected_result: 'כל המסכים נטענים בהצלחה, אין קישורים שבורים' },
        { step: 2, action: 'בדיקת breadcrumbs / מיקום נוכחי', expected_result: 'המשתמש תמיד יודע איפה הוא נמצא' },
        { step: 3, action: 'שימוש בכפתורי "חזור" ו"קדימה" בדפדפן', expected_result: 'ניווט תקין, אין אובדן מצב' },
        { step: 4, action: 'בדיקת קיצורי מקלדת (Tab, Enter)', expected_result: 'ניווט נגיש במקלדת' }
      ]
    });
    tests.push({
      title: 'אחידות ממשק המשתמש',
      description: 'בדיקה שכל המסכים עקביים בעיצוב ובהתנהגות',
      priority: 4,
      steps: [
        { step: 1, action: 'השוואת גודל פונטים, צבעים וריווחים בין מסכים', expected_result: 'עיצוב אחיד בכל המערכת' },
        { step: 2, action: 'בדיקת מיקום כפתורים (שמור, בטל) בטפסים שונים', expected_result: 'כפתורים באותו מיקום ובאותו סגנון' },
        { step: 3, action: 'בדיקת שפה ומונחים — עברית עקבית', expected_result: 'אין ערבוב שפות או מונחים סותרים' }
      ]
    });
    return tests;
  }

  // --- Stage 8: Data Tests ---
  _stage8_dataTests(analysis, modules) {
    const tests = [];
    tests.push({
      title: 'שמירת נתונים — עקביות ושלמות',
      description: 'בדיקה ששמירת נתונים עובדת נכון מקצה לקצה',
      priority: 1,
      steps: [
        { step: 1, action: 'יצירת רשומה חדשה עם כל השדות מלאים', expected_result: 'הרשומה נשמרת בהצלחה' },
        { step: 2, action: 'סגירת המסך ופתיחה מחדש', expected_result: 'הנתונים שנשמרו מוצגים במלואם' },
        { step: 3, action: 'אימות הנתונים בבסיס הנתונים (אם יש גישה)', expected_result: 'הנתונים בDB תואמים למה שהוזן' },
        { step: 4, action: 'בדיקת תווים מיוחדים (גרשיים, סלש, עברית)', expected_result: 'כל התווים נשמרים ומוצגים נכון' }
      ],
      testData: 'טקסט עם גרשיים: "test\'s", סלש: a/b, עברית: שלום'
    });
    tests.push({
      title: 'עדכון נתונים — שינוי ושמירה',
      description: 'בדיקה שעדכון נתונים קיימים עובד נכון',
      priority: 1,
      steps: [
        { step: 1, action: 'פתיחת רשומה קיימת לעריכה', expected_result: 'כל הנתונים הקיימים מוצגים בטופס העריכה' },
        { step: 2, action: 'שינוי שדה אחד בלבד ושמירה', expected_result: 'רק השדה שהשתנה מתעדכן, שאר השדות נשארים' },
        { step: 3, action: 'שינוי מספר שדות בו-זמנית ושמירה', expected_result: 'כל השינויים נשמרים' },
        { step: 4, action: 'ביטול עריכה (Cancel)', expected_result: 'הנתונים חוזרים למצב המקורי' }
      ]
    });
    tests.push({
      title: 'מחיקת נתונים — בטיחות ועקביות',
      description: 'בדיקת תהליך מחיקה מלא',
      priority: 2,
      steps: [
        { step: 1, action: 'בחירת רשומה למחיקה', expected_result: 'הרשומה מסומנת' },
        { step: 2, action: 'לחיצה על מחיקה', expected_result: 'מוצג דיאלוג אישור "האם אתה בטוח?"' },
        { step: 3, action: 'ביטול המחיקה', expected_result: 'הרשומה לא נמחקת' },
        { step: 4, action: 'אישור המחיקה', expected_result: 'הרשומה נמחקת מהרשימה ומבסיס הנתונים' },
        { step: 5, action: 'אימות שרשומות תלויות טופלו', expected_result: 'אין רשומות יתומות (orphaned records)' }
      ]
    });
    return tests;
  }

  // --- Stage 9: Spec Gaps ---
  _stage9_findGaps(analysis, modules) {
    const gaps = [];
    if (analysis.nonFunctionalReqs.length === 0) {
      gaps.push({ requirement: 'דרישות ביצועים (Performance Requirements)', impact: 'לא ניתן לבדוק SLA וזמני תגובה', recommendation: 'הגדרת זמני תגובה מקסימליים לכל פעולה' });
    }
    if (!analysis.features.some(f => /שגיאה|כשל|נפילה|fallback/i.test(f.text))) {
      gaps.push({ requirement: 'טיפול בשגיאות (Error Handling)', impact: 'לא ברור כיצד המערכת מתנהגת בכשלים', recommendation: 'תיעוד תרחישי שגיאה וההתנהגות הצפויה' });
    }
    if (!analysis.features.some(f => /הרשא|תפקיד|admin|גישה/i.test(f.text))) {
      gaps.push({ requirement: 'מודל הרשאות (Authorization Model)', impact: 'לא ניתן לבדוק הגבלות גישה', recommendation: 'הגדרת תפקידים והרשאות לכל פעולה' });
    }
    if (!analysis.features.some(f => /log|לוג|audit|ביקורת|מעקב/i.test(f.text))) {
      gaps.push({ requirement: 'לוגים ומעקב (Audit Trail)', impact: 'אין יכולת לעקוב אחרי פעולות', recommendation: 'הגדרת דרישות לוג לכל פעולה קריטית' });
    }
    if (analysis.integrations.length > 0 && !analysis.features.some(f => /timeout|retry|fallback/i.test(f.text))) {
      gaps.push({ requirement: 'טיפול בכשלי ממשקים (Integration Failure Handling)', impact: 'לא ברור מה קורה כשממשק חיצוני לא זמין', recommendation: 'הגדרת timeout, retry policy ו-fallback לכל ממשק' });
    }
    return gaps;
  }

  // --- Security Tests ---
  _generateSecurityTests(analysis) {
    const tests = [];
    tests.push({
      title: 'הזרקת SQL (SQL Injection)',
      description: 'בדיקה שהמערכת מוגנת מפני הזרקת SQL',
      preconditions: 'המשתמש מחובר למערכת',
      steps: [
        { step: 1, action: "הזנת ' OR '1'='1 בשדה חיפוש", expected_result: 'המערכת לא מחזירה תוצאות לא מורשות' },
        { step: 2, action: "הזנת '; DROP TABLE -- בשדה טקסט", expected_result: 'המערכת מסננת את הקלט, אין נזק לDB' },
        { step: 3, action: 'בדיקת לוג שגיאות לאחר ניסיונות', expected_result: 'הניסיונות נרשמים בלוג אבטחה' }
      ]
    });
    tests.push({
      title: 'הזרקת סקריפט (XSS)',
      description: 'בדיקה שהמערכת מוגנת מפני XSS',
      preconditions: 'המשתמש מחובר למערכת',
      steps: [
        { step: 1, action: 'הזנת <script>alert("XSS")</script> בשדה טקסט', expected_result: 'הסקריפט לא מורץ, מוצג כטקסט או מסונן' },
        { step: 2, action: 'הזנת <img onerror="alert(1)" src="x"> בשדה', expected_result: 'אין הרצת קוד JavaScript' },
        { step: 3, action: 'שמירה וטעינה מחדש', expected_result: 'הקלט מנוקה (sanitized) בתצוגה' }
      ]
    });
    if (analysis.integrations.length > 0) {
      tests.push({
        title: 'אבטחת ממשקים (API Security)',
        description: 'בדיקת אבטחת הממשקים החיצוניים',
        preconditions: 'גישה לכלי בדיקת API',
        steps: [
          { step: 1, action: 'שליחת בקשת API ללא טוקן אימות', expected_result: 'שגיאת 401 Unauthorized' },
          { step: 2, action: 'שליחת בקשה עם טוקן פג תוקף', expected_result: 'שגיאת 401, הודעה על טוקן לא תקף' },
          { step: 3, action: 'ניסיון גישה לנתוני משתמש אחר', expected_result: 'שגיאת 403 Forbidden' },
          { step: 4, action: 'שליחת payload גדול מהמותר', expected_result: 'שגיאת 413 או הגבלה' }
        ]
      });
    }
    return tests;
  }

  // --- Helper: Build Detailed Steps ---
  _buildDetailedSteps(requirement, moduleName) {
    const steps = [];
    let stepNum = 0;
    const lower = requirement;

    steps.push({ step: ++stepNum, action: `ניווט למודול "${moduleName}" במערכת`, expected_result: 'המסך נטען בהצלחה, כל הרכיבים מוצגים' });

    if (/מעביר|שולח|העברת|העבר/i.test(lower)) {
      steps.push({ step: ++stepNum, action: 'אימות שמקור הנתונים מכיל את המידע הנדרש', expected_result: 'המידע קיים ותקין במקור' });
      steps.push({ step: ++stepNum, action: `הפעלת תהליך ההעברה: ${this._shortenText(requirement, 50)}`, expected_result: 'התהליך מתחיל ללא שגיאות' });
      steps.push({ step: ++stepNum, action: 'המתנה לסיום התהליך ובדיקת סטטוס', expected_result: 'התהליך הושלם בהצלחה' });
      steps.push({ step: ++stepNum, action: 'אימות שהנתונים הגיעו ליעד בשלמות', expected_result: 'הנתונים ביעד תואמים למקור' });
      steps.push({ step: ++stepNum, action: 'בדיקת לוג/היסטוריה של ההעברה', expected_result: 'ההעברה מתועדת עם חותמת זמן ופרטים' });
    } else if (/מציג|הצגת|תצוגת|מוצג|יוצג/i.test(lower)) {
      steps.push({ step: ++stepNum, action: 'הכנת נתוני בדיקה — יצירת רשומות לתצוגה', expected_result: 'הנתונים קיימים במערכת' });
      steps.push({ step: ++stepNum, action: `אימות תצוגה: ${this._shortenText(requirement, 50)}`, expected_result: 'כל הנתונים מוצגים בצורה נכונה וברורה' });
      steps.push({ step: ++stepNum, action: 'בדיקת פורמט נתונים (תאריכים, מספרים, מטבע)', expected_result: 'כל הפורמטים תואמים לדרישות' });
      steps.push({ step: ++stepNum, action: 'בדיקת מיון — לחיצה על כותרות עמודות', expected_result: 'המיון עובד בכל העמודות הרלוונטיות' });
      steps.push({ step: ++stepNum, action: 'בדיקת תצוגה ריקה (ללא נתונים)', expected_result: 'הודעה מתאימה "אין נתונים להצגה"' });
    } else if (/מחשב|חישוב|סיכום|סכום|יתרה/i.test(lower)) {
      steps.push({ step: ++stepNum, action: 'הכנת נתוני בדיקה עם ערכים ידועים', expected_result: 'הנתונים מוכנים לחישוב' });
      steps.push({ step: ++stepNum, action: `הרצת החישוב: ${this._shortenText(requirement, 50)}`, expected_result: 'החישוב מתבצע' });
      steps.push({ step: ++stepNum, action: 'אימות תוצאת החישוב מול חישוב ידני', expected_result: 'התוצאה תואמת לחישוב הידני' });
      steps.push({ step: ++stepNum, action: 'בדיקת עיגולים ודיוק', expected_result: 'העיגולים תואמים לכללים העסקיים' });
      steps.push({ step: ++stepNum, action: 'בדיקה עם ערכי 0 וערכים שליליים', expected_result: 'החישוב מטפל בערכים חריגים' });
    } else if (/מעדכן|עדכון|שינוי|עריכ/i.test(lower)) {
      steps.push({ step: ++stepNum, action: 'בחירת רשומה קיימת לעדכון', expected_result: 'פרטי הרשומה מוצגים' });
      steps.push({ step: ++stepNum, action: `ביצוע עדכון: ${this._shortenText(requirement, 50)}`, expected_result: 'השינוי מתקבל' });
      steps.push({ step: ++stepNum, action: 'שמירת השינויים', expected_result: 'הודעת הצלחה מוצגת' });
      steps.push({ step: ++stepNum, action: 'רענון המסך ואימות שהשינוי נשמר', expected_result: 'הנתונים המעודכנים מוצגים' });
      steps.push({ step: ++stepNum, action: 'בדיקת היסטוריית שינויים (אם קיימת)', expected_result: 'השינוי מתועד בהיסטוריה' });
    } else if (/מוחק|מחיקת|הסרת/i.test(lower)) {
      steps.push({ step: ++stepNum, action: 'בחירת רשומה למחיקה', expected_result: 'הרשומה מסומנת' });
      steps.push({ step: ++stepNum, action: 'לחיצה על כפתור מחיקה', expected_result: 'דיאלוג אישור מוצג' });
      steps.push({ step: ++stepNum, action: 'אישור המחיקה', expected_result: 'הרשומה נמחקת והרשימה מתעדכנת' });
      steps.push({ step: ++stepNum, action: 'חיפוש הרשומה שנמחקה', expected_result: 'הרשומה לא נמצאת' });
    } else {
      steps.push({ step: ++stepNum, action: `ביצוע הפעולה: ${this._shortenText(requirement, 60)}`, expected_result: 'הפעולה מתבצעת ללא שגיאות' });
      steps.push({ step: ++stepNum, action: 'אימות התוצאה הצפויה', expected_result: 'התוצאה תואמת לדרישה' });
      steps.push({ step: ++stepNum, action: 'רענון המסך ובדיקה חוזרת', expected_result: 'התוצאה עקבית לאחר רענון' });
      steps.push({ step: ++stepNum, action: 'בדיקת השפעה על מודולים אחרים', expected_result: 'אין השפעה שלילית על חלקים אחרים במערכת' });
    }

    return steps;
  }

  _buildPreconditions(requirement, moduleName) {
    const parts = [`המשתמש מחובר למערכת עם הרשאות מתאימות`];
    if (/עדכון|עריכ|מחיק/i.test(requirement)) parts.push('קיימת רשומה רלוונטית במערכת');
    if (/דוח|תצוגה|הצגה/i.test(requirement)) parts.push('קיימים נתונים במערכת לתצוגה');
    if (/ממשק|אינטגרציה|AMF|GP/i.test(requirement)) parts.push('הממשק החיצוני זמין ותקין');
    return parts.join('. ');
  }

  _assessPriority(text) {
    if (/חייב|קריטי|חובה|אבטחה|כספי|תמורה|יתרה|סליקה/i.test(text)) return 1;
    if (/צריך|חשוב|מעביר|שולח|מחשב|מעדכן/i.test(text)) return 2;
    if (/מציג|מאפשר|תומך|נוח|ידידותי/i.test(text)) return 3;
    return 3;
  }

  _suggestTestData(requirement) {
    if (/סכום|מחיר|ערך|תמורה/i.test(requirement)) return 'סכומים: 100, 0, -50, 999999.99, 0.01';
    if (/תאריך|מועד|יום/i.test(requirement)) return 'תאריכים: היום, אתמול, מחר, סוף חודש, תחילת שנה';
    if (/שם|טקסט|כותרת/i.test(requirement)) return 'טקסט: עברית, אנגלית, תווים מיוחדים, ריק, ארוך מאוד (500 תווים)';
    return '';
  }

  _shortenText(text, maxLen) {
    if (text.length <= maxLen) return text;
    return text.substring(0, maxLen - 3) + '...';
  }

  _textOverlap(t1, t2) {
    const w1 = new Set(this._tokenize(t1));
    const w2 = new Set(this._tokenize(t2));
    const intersection = new Set([...w1].filter(x => w2.has(x)));
    const union = new Set([...w1, ...w2]);
    return union.size > 0 ? intersection.size / union.size : 0;
  }

  _generateArchitectEnglish(content, options) {
    const lines = content.split('\n').filter(l => l.trim());
    const tests = [];
    let tc = 0;
    const features = lines.filter(l => /^[-*•]/.test(l.trim()) || /^#+\s/.test(l.trim()) || /should|must|can|allow|enable|display/i.test(l));

    features.forEach(f => {
      const cl = f.replace(/^[-*•#\s]+/, '').trim();
      if (cl.length < 5) return;
      const p = /must|critical|security/i.test(cl) ? 1 : /should|important/i.test(cl) ? 2 : 3;
      tests.push({
        test_key: `TC-${String(++tc).padStart(3, '0')}`, module: 'General', title: `Verify: ${cl}`,
        description: `Validate: ${cl}`, priority: p, severity: p === 1 ? 'critical' : 'major',
        type: 'manual', category: 'functional', section: 'General',
        steps: [
          { step: 1, action: 'Navigate to the relevant area', expected_result: 'Page loads successfully' },
          { step: 2, action: `Perform: ${cl}`, expected_result: 'Action completes without errors' },
          { step: 3, action: 'Verify the expected outcome', expected_result: 'Result matches the requirement' },
          { step: 4, action: 'Refresh and verify persistence', expected_result: 'Result persists after refresh' }
        ]
      });
      tests.push({
        test_key: `TC-${String(++tc).padStart(3, '0')}`, module: 'General', title: `[Negative] ${cl}`,
        description: `Error handling for: ${cl}`, priority: Math.min(p + 1, 4), severity: 'major',
        type: 'manual', category: 'negative', section: 'General',
        steps: [
          { step: 1, action: 'Navigate to the feature', expected_result: 'Page loads' },
          { step: 2, action: 'Enter invalid/empty data', expected_result: 'Validation error shown' },
          { step: 3, action: 'Verify system stability after error', expected_result: 'No crash, graceful handling' }
        ]
      });
    });

    return { tests, specAnalysis: null, modules: [{ name: 'General', description: 'General requirements' }],
      missingRequirements: [], traceabilityMatrix: [],
      summary: { totalTests: tests.length, byCategory: { functional: Math.ceil(tests.length/2), negative: Math.floor(tests.length/2) }, byPriority: {} },
      model: 'qa-architect-v2-en', confidence: 0.75, totalGenerated: tests.length };
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
