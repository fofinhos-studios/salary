import { formatSalaryText, money as displayMoney, parseAmount, type Period } from "./core";
import { rateSchema, taxRulesSchema, type Currency, type Rate, type TaxRules } from "./contracts";
import { compareBrazil, type Inputs } from "./brCore";
import type { Language } from "./i18n";

type MoneyKey = Exclude<{ [K in keyof Inputs]: Inputs[K] extends number ? K : never }[keyof Inputs],
  "dependents" | "mealDays" | "fgtsShare" | "issRate" | "foreignFeeRate"
  | "pjPaidVacationDays" | "pjVacationDays">;
type Field = { key: MoneyKey; en: string; pt: string; tipEn: string; tipPt: string; group: "clt" | "pj" | "shared"; advanced?: boolean };
const fields: Field[] = [
  { key: "cltMonthly", en: "Fixed gross pay", pt: "Salário fixo bruto", tipEn: "Converted to a monthly base. Vacation pay is already included in the 12 regular months.", tipPt: "Convertido em base mensal. As férias já estão incluídas nos 12 meses regulares.", group: "clt" },
  { key: "variableMonthly", en: "Variable monthly gross", pt: "Variável bruta mensal", tipEn: "Added to the recurring salary and 13th.", tipPt: "Soma ao salário recorrente e ao 13º.", group: "clt", advanced: true },
  { key: "plrAnnual", en: "Annual profit sharing", pt: "PLR anual", tipEn: "Taxed separately using the PLR table.", tipPt: "Tributada separadamente pela tabela de PLR.", group: "clt", advanced: true },
  { key: "mealDaily", en: "Daily meal benefit", pt: "Vale-refeição diário", tipEn: "Daily value × paid days × 12.", tipPt: "Valor diário × dias pagos × 12.", group: "clt", advanced: true },
  { key: "healthMonthly", en: "Monthly health benefit", pt: "Plano de saúde mensal", tipEn: "Included in package, not cash.", tipPt: "Incluído no pacote, não no caixa.", group: "clt", advanced: true },
  { key: "cltOtherBenefitsMonthly", en: "Other monthly benefits", pt: "Outros benefícios mensais", tipEn: "Included in package, not cash.", tipPt: "Incluídos no pacote, não no caixa.", group: "clt", advanced: true },
  { key: "cltDeductionsAnnual", en: "Other annual deductions", pt: "Outros descontos anuais", tipEn: "Union dues or similar out-of-pocket costs.", tipPt: "Contribuição sindical ou custos semelhantes.", group: "clt", advanced: true },
  { key: "pjMonthly", en: "Invoice amount", pt: "Valor da nota fiscal", tipEn: "Converted to a monthly invoice before company taxes and fees.", tipPt: "Convertido em nota mensal antes dos impostos e tarifas.", group: "pj" },
  { key: "pjBenefitsMonthly", en: "Monthly benefits", pt: "Benefícios mensais", tipEn: "Client-paid benefits; excluded from taxable invoice.", tipPt: "Benefícios pagos pelo cliente, fora da nota tributável.", group: "pj", advanced: true },
  { key: "accountantMonthly", en: "Accountant monthly", pt: "Contador mensal", tipEn: "Company operating expense.", tipPt: "Despesa operacional da empresa.", group: "pj", advanced: true },
  { key: "businessAnnual", en: "Other annual business expenses", pt: "Outras despesas anuais da empresa", tipEn: "Real cash costs; they do not reduce presumptive revenue.", tipPt: "Custos efetivos; não reduzem a receita presumida.", group: "pj", advanced: true },
  { key: "insuranceMonthly", en: "Income protection monthly", pt: "Seguro de renda mensal", tipEn: "Company cash expense.", tipPt: "Despesa da empresa.", group: "pj", advanced: true },
  { key: "proLaboreMonthly", en: "Monthly pró-labore", pt: "Pró-labore mensal", tipEn: "Empty uses 28% of invoice, subject to the minimum wage.", tipPt: "Vazio usa 28% da nota, respeitando o salário mínimo.", group: "pj", advanced: true },
  { key: "previousRevenue", en: "Previous 12-month revenue", pt: "Receita dos 12 meses anteriores", tipEn: "Determines the Simples tax bracket and fator R.", tipPt: "Define faixa do Simples e fator R.", group: "pj", advanced: true },
  { key: "previousPayroll", en: "Previous 12-month payroll", pt: "Folha dos 12 meses anteriores", tipEn: "Used in fator R = payroll / revenue.", tipPt: "Usada no fator R = folha / receita.", group: "pj", advanced: true },
  { key: "foreignFeeFixed", en: "Fixed monthly exchange fee", pt: "Tarifa de câmbio fixa mensal", tipEn: "Receiving or transfer fee converted to BRL.", tipPt: "Tarifa de recebimento convertida para BRL.", group: "pj", advanced: true },
  { key: "otherTaxableAnnual", en: "Other annual taxable income", pt: "Outras rendas tributáveis anuais", tipEn: "Affects incremental tax; excluded from offer value.", tipPt: "Afeta o imposto incremental, fora do valor da oferta.", group: "shared", advanced: true },
  { key: "otherExemptAnnual", en: "Other exempt income", pt: "Outras rendas isentas", tipEn: "Used when reviewing high-income rules.", tipPt: "Usada para analisar regras de alta renda.", group: "shared", advanced: true },
  { key: "educationAnnual", en: "Education expenses", pt: "Despesas com educação", tipEn: "Annual legal cap applies.", tipPt: "Aplica-se o limite legal anual.", group: "shared", advanced: true },
  { key: "medicalAnnual", en: "Eligible health expenses", pt: "Despesas médicas dedutíveis", tipEn: "Only documented deductible expenses.", tipPt: "Apenas despesas dedutíveis comprovadas.", group: "shared", advanced: true },
  { key: "pensionAnnual", en: "Deductible support payments", pt: "Pensão alimentícia dedutível", tipEn: "Only payments meeting legal conditions.", tipPt: "Apenas pagamentos que atendam à lei.", group: "shared", advanced: true },
  { key: "pgblAnnual", en: "PGBL contributions", pt: "Contribuições PGBL", tipEn: "Subject to the applicable deduction cap.", tipPt: "Sujeitas ao limite de dedução aplicável.", group: "shared", advanced: true },
];
const copy = {
  en: { intro: "Compare a Brazilian employment contract with a Brazilian service company, including a foreign client.",
    clt: "Employment · CLT", pj: "Company · PJ", advanced: "More inputs", shared: "Personal tax profile",
    currency: "Currency", hours: "Hours/week", regime: "Tax regime", export: "Qualifying export of services",
    period: "Offer period", hourly: "Hourly", monthlyPeriod: "Monthly", annualPeriod: "Annual",
    yes: "Yes", no: "No", vacation: "Unpaid vacation days/year", paid: "Paid vacation days/year",
    fgts: "FGTS counted in package (%)", days: "Meal benefit days/month", dependents: "Dependents",
    iss: "Municipal ISS rate (%)", fee: "Exchange fee (%)", rate: "BRL per 1 unit", auto: "Reference rate", manual: "Manual rate",
    result: "Annual package comparison", empty: "Enter both offers to compare.", unavailable: "Complete required tax and exchange inputs.",
    winner: "Higher package", delta: "Annual difference", monthly: "Monthly equivalent", rateNote: "Tax uses BRL. Reference exchange rates are projections, not tax records.",
    revenueGroup: "Income and benefits", taxGroup: "Taxes and costs", resultGroup: "Net result", stale: "previous quote",
    gross: "Gross income", benefits: "Benefits", payrollTax: "Social security", incomeTax: "Personal income tax", corporateTax: "Company tax", expenses: "Other costs", fgtsRow: "FGTS", cash: "Cash during year", adjustment: "Annual tax adjustment", net: "Cash after adjustment", package: "Comparable package",
    source: "2026 tax rules", projected_rbt12: "Simples bracket projected from current invoice.", simples_limit: "Above the Simples annual limit; result unavailable.",
    export_eligibility: "Export tax treatment assumes the service and its result qualify abroad; keep supporting documents.", iss_required: "Enter the applicable municipal ISS rate.",
    simples_sublimit: "Above the Simples ISS sublimit, municipal tax needs separate calculation; result unavailable.",
    presumed_high_revenue: "Revenue above R$5 million requires 2026 presumption adjustment; result unavailable.",
    high_income_review: "High-income minimum tax needs a detailed annual review; result unavailable.", error: "Rules unavailable for this year.",
    company_deficit: "The company cannot fund the selected pró-labore and costs with this revenue." },
  pt: { intro: "Compare CLT brasileira com PJ brasileira de serviços, inclusive para clientes do exterior.",
    clt: "Emprego · CLT", pj: "Empresa · PJ", advanced: "Mais entradas", shared: "Perfil fiscal pessoal",
    currency: "Moeda", hours: "Horas/semana", regime: "Regime tributário", export: "Exportação de serviços elegível",
    period: "Período da oferta", hourly: "Por hora", monthlyPeriod: "Mensal", annualPeriod: "Anual",
    yes: "Sim", no: "Não", vacation: "Dias de férias não remuneradas/ano", paid: "Dias de férias remuneradas/ano",
    fgts: "FGTS considerado no pacote (%)", days: "Dias de vale-refeição/mês", dependents: "Dependentes",
    iss: "Alíquota municipal de ISS (%)", fee: "Tarifa de câmbio (%)", rate: "BRL por 1 unidade", auto: "Cotação de referência", manual: "Cotação manual",
    result: "Comparação do pacote anual", empty: "Informe as duas ofertas para comparar.", unavailable: "Complete os dados fiscais e cambiais necessários.",
    winner: "Maior pacote", delta: "Diferença anual", monthly: "Equivalente mensal", rateNote: "Impostos usam BRL. Cotações de referência são projeções, não registros fiscais.",
    revenueGroup: "Rendimentos e benefícios", taxGroup: "Impostos e custos", resultGroup: "Resultado líquido", stale: "cotação anterior",
    gross: "Rendimento bruto", benefits: "Benefícios", payrollTax: "Previdência", incomeTax: "Imposto pessoal", corporateTax: "Impostos da empresa", expenses: "Outros custos", fgtsRow: "FGTS", cash: "Caixa durante o ano", adjustment: "Ajuste anual de IR", net: "Caixa após ajuste", package: "Pacote comparável",
    source: "Regras fiscais de 2026", projected_rbt12: "Faixa do Simples projetada pela nota atual.", simples_limit: "Acima do limite anual do Simples; resultado indisponível.",
    export_eligibility: "O tratamento de exportação pressupõe serviço e resultado enquadrados no exterior; guarde os documentos.", iss_required: "Informe a alíquota municipal aplicável de ISS.",
    simples_sublimit: "Acima do sublimite de ISS do Simples, o imposto municipal exige apuração separada; resultado indisponível.",
    presumed_high_revenue: "Receita acima de R$ 5 milhões exige ajuste da presunção em 2026; resultado indisponível.",
    high_income_review: "Tributação mínima de altas rendas exige apuração anual detalhada; resultado indisponível.", error: "Regras indisponíveis para este ano.",
    company_deficit: "A receita não cobre o pró-labore e os custos informados." },
} as const;

const initial: Inputs = { cltMonthly: 0, variableMonthly: 0, plrAnnual: 0, mealDaily: 0,
  mealDays: 21, healthMonthly: 0, cltOtherBenefitsMonthly: 0, cltDeductionsAnnual: 0,
  fgtsShare: .5, pjMonthly: 0, pjPaidVacationDays: 0, pjVacationDays: 0,
  pjBenefitsMonthly: 0, accountantMonthly: 0, businessAnnual: 0,
  insuranceMonthly: 0, proLaboreMonthly: 0, previousRevenue: 0, previousPayroll: 0,
  issRate: 0, regime: "simples", exportServices: false, foreignFeeRate: 0, foreignFeeFixed: 0,
  dependents: 0, educationAnnual: 0, medicalAnnual: 0, pensionAnnual: 0,
  pgblAnnual: 0, otherTaxableAnnual: 0, otherExemptAnnual: 0 };

export function mountBrazil(getLanguage: () => Language, getCurrencies: () => Currency[]) {
  const panel = document.getElementById("brazil-panel")!;
  const input: Inputs = { ...initial };
  let rules: TaxRules | null = null;
  let rulesError = false, loadingRules = false;
  let currency: { clt: string; pj: string } = { clt: "BRL", pj: "BRL" };
  let quotes: { clt: Rate | null; pj: Rate | null } = { clt: null, pj: null };
  let manual: { clt: number | null; pj: number | null } = { clt: null, pj: null };
  let mode: { clt: "auto" | "manual"; pj: "auto" | "manual" } = { clt: "auto", pj: "auto" };
  let period: { clt: Period; pj: Period } = { clt: "monthly", pj: "monthly" };
  let hours: { clt: number; pj: number } = { clt: 40, pj: 40 };
  let request = 0;
  const locale = () => getLanguage() === "pt" ? "pt-BR" : "en-US";
  const t = () => copy[getLanguage()];
  const $ = <T extends HTMLElement = HTMLElement>(id: string): T => panel.querySelector<T>(`#${id}`)!;
  const number = (value: number) => new Intl.NumberFormat(locale(), { maximumFractionDigits: 2 }).format(value);
  const brl = (value: number) => displayMoney(value, "BRL", locale());
  const baseKey = (side: "clt" | "pj") => side === "clt" ? "cltMonthly" : "pjMonthly";
  const displayed = (side: "clt" | "pj") => period[side] === "monthly" ? input[baseKey(side)]
    : period[side] === "annual" ? input[baseKey(side)] * 12
    : input[baseKey(side)] * 12 / (hours[side] * 52);
  const field = (item: Field) => {
    const side = item.key === "cltMonthly" ? "clt" : item.key === "pjMonthly" ? "pj" : null;
    const value = side ? displayed(side) : input[item.key];
    return `<div class="br-field"><label for="br-${item.key}">${getLanguage() === "pt" ? item.pt : item.en}</label><button class="br-help" type="button" aria-label="${getLanguage() === "pt" ? "Explicação" : "Explanation"}" aria-expanded="false" data-help="${item.key}">?</button><div class="br-tooltip" id="br-tip-${item.key}" role="tooltip" hidden>${getLanguage() === "pt" ? item.tipPt : item.tipEn}</div><input id="br-${item.key}" data-money="${item.key}" type="text" inputmode="decimal" autocomplete="off" value="${value ? number(value) : ""}"></div>`;
  };
  const periodFields = (side: "clt" | "pj") => `<div class="br-period"><div class="br-field"><label for="br-${side}-period">${t().period}</label><select id="br-${side}-period" data-period="${side}"><option value="hourly" ${period[side] === "hourly" ? "selected" : ""}>${t().hourly}</option><option value="monthly" ${period[side] === "monthly" ? "selected" : ""}>${t().monthlyPeriod}</option><option value="annual" ${period[side] === "annual" ? "selected" : ""}>${t().annualPeriod}</option></select></div><div class="br-field"><label for="br-${side}-hours">${t().hours}</label><input id="br-${side}-hours" data-hours="${side}" type="number" min="1" max="168" value="${hours[side]}"></div></div>`;
  const extraHelp: Record<string, [string, string]> = {
    "br-fgts": ["Share of the employer's FGTS deposit counted as compensation; the cash is not normally withdrawable on demand.", "Parcela do depósito patronal do FGTS considerada no pacote; o saldo normalmente não pode ser sacado de imediato."],
    "br-mealDays": ["Paid meal-benefit days each month.", "Dias de vale pagos por mês."],
    "br-regime": ["Select Simples Nacional or Lucro Presumido for the Brazilian services company.", "Selecione Simples Nacional ou Lucro Presumido para a empresa brasileira de serviços."],
    "br-export": ["Only select when the service legally qualifies as an export; eligibility needs document review.", "Selecione apenas se o serviço se enquadrar legalmente como exportação; a elegibilidade exige análise documental."],
    "br-pjVacationDays": ["Days without an invoice, reducing annual company revenue.", "Dias sem emissão de nota, reduzindo o faturamento anual."],
    "br-pjPaidVacationDays": ["Vacation days that the client still pays; must not exceed total vacation days.", "Dias de férias ainda remunerados pelo cliente; não podem exceder o total de férias."],
    "br-issRate": ["Applicable municipal ISS rate for Lucro Presumido services, usually between 2% and 5%.", "Alíquota de ISS municipal aplicável aos serviços no Lucro Presumido, normalmente entre 2% e 5%."],
    "br-foreignFeeRate": ["Percentage lost to receiving or currency conversion fees.", "Percentual perdido em tarifas de recebimento ou conversão cambial."],
  };
  const group = (side: "clt" | "pj") => {
    const rows = fields.filter(item => item.group === side);
    return `<section class="br-card"><h2>${t()[side]}</h2><div class="br-field"><label for="br-${side}-currency">${t().currency}</label><select id="br-${side}-currency" data-currency="${side}"></select></div>${rows.filter(item => !item.advanced).map(field).join("")}${periodFields(side)}<details><summary>${t().advanced}</summary>${rows.filter(item => item.advanced).map(field).join("")}</details>${side === "clt" ? `<div class="br-field"><label for="br-fgts">${t().fgts}</label><input id="br-fgts" data-number="fgtsShare" type="number" min="0" max="100" value="${input.fgtsShare * 100}"></div><div class="br-field"><label for="br-mealDays">${t().days}</label><input id="br-mealDays" data-number="mealDays" type="number" min="0" max="31" value="${input.mealDays}"></div>` : `<div class="br-field"><label for="br-regime">${t().regime}</label><select id="br-regime"><option value="simples">Simples Nacional</option><option value="presumido">Lucro Presumido</option></select></div><div class="br-field"><label for="br-export">${t().export}</label><select id="br-export"><option value="false">${t().no}</option><option value="true">${t().yes}</option></select></div><div class="br-field"><label for="br-pjVacationDays">${t().vacation}</label><input id="br-pjVacationDays" data-number="pjVacationDays" type="number" min="0" max="365" value="${input.pjVacationDays}"></div><div class="br-field"><label for="br-pjPaidVacationDays">${t().paid}</label><input id="br-pjPaidVacationDays" data-number="pjPaidVacationDays" type="number" min="0" max="365" value="${input.pjPaidVacationDays}"></div><div class="br-field"><label for="br-issRate">${t().iss}</label><input id="br-issRate" data-number="issRate" type="number" min="0" max="5" step="0.01" value="${input.issRate * 100}"></div><div class="br-field"><label for="br-foreignFeeRate">${t().fee}</label><input id="br-foreignFeeRate" data-number="foreignFeeRate" type="number" min="0" max="100" step="0.01" value="${input.foreignFeeRate * 100}"></div>`}<fieldset class="br-rate"><legend>${t().rate}</legend><label><input type="radio" name="br-${side}-mode" data-rate-mode="${side}" value="auto" ${mode[side] === "auto" ? "checked" : ""}>${t().auto}</label><label><input type="radio" name="br-${side}-mode" data-rate-mode="${side}" value="manual" ${mode[side] === "manual" ? "checked" : ""}>${t().manual}</label><input id="br-${side}-manual" data-manual="${side}" type="text" inputmode="decimal" value="${manual[side] === null ? "" : number(manual[side])}" aria-label="${t().rate}" ${mode[side] === "auto" ? "hidden" : ""}><small id="br-${side}-source"></small></fieldset></section>`;
  };
  function build() {
    const open = [...panel.querySelectorAll<HTMLDetailsElement>("details")].map(item => item.open);
    panel.innerHTML = `<p class="br-intro">${t().intro}</p><div class="br-grid">${group("clt")}${group("pj")}</div><details class="br-personal" ${open[2] ? "open" : ""}><summary>${t().shared}</summary><div class="br-personal-grid"><div class="br-field"><label for="br-dependents">${t().dependents}</label><input id="br-dependents" data-number="dependents" type="number" min="0" step="1" value="${input.dependents}"></div>${fields.filter(item => item.group === "shared").map(field).join("")}</div></details><section class="br-report" aria-labelledby="br-report-title"><h2 id="br-report-title">${t().result}</h2><div id="br-result"></div><p id="br-source" class="hint"></p></section><p class="hint">${t().rateNote}</p><p id="br-announcement" class="sr-only" role="status" aria-live="polite"></p>`;
    for (const [id, descriptions] of Object.entries(extraHelp)) {
      const label = panel.querySelector<HTMLLabelElement>(`label[for="${id}"]`);
      const parent = label?.closest(".br-field");
      if (!label || !parent) continue;
      const button = document.createElement("button");
      button.type = "button"; button.className = "br-help"; button.textContent = "?";
      button.dataset.help = id; button.setAttribute("aria-label", getLanguage() === "pt" ? "Explicação" : "Explanation");
      button.setAttribute("aria-expanded", "false");
      const tip = document.createElement("span");
      tip.id = `br-tip-${id}`; tip.className = "br-tooltip"; tip.setAttribute("role", "tooltip");
      tip.hidden = true; tip.textContent = descriptions[getLanguage() === "pt" ? 1 : 0];
      label.after(button); parent.append(tip);
    }
    panel.querySelectorAll<HTMLDetailsElement>(".br-card details").forEach((item, index) => { item.open = open[index] ?? false; });
    $("br-regime").querySelector<HTMLOptionElement>(`option[value="${input.regime}"]`)!.selected = true;
    $("br-export").querySelector<HTMLOptionElement>(`option[value="${input.exportServices}"]`)!.selected = true;
    refreshCurrencies();
    render();
  }
  function refreshCurrencies() {
    for (const side of ["clt", "pj"] as const) {
      const select = $<HTMLSelectElement>(`br-${side}-currency`);
      select.replaceChildren();
      const list = new Map([["BRL", "Brazilian Real"], ...getCurrencies().map(item => [item.code, item.name] as [string, string])]);
      for (const [code, name] of list) {
        const option = document.createElement("option");
        option.value = code;
        option.textContent = `${code} · ${name}`;
        option.selected = code === currency[side];
        select.add(option);
      }
    }
  }
  const rate = (side: "clt" | "pj") => currency[side] === "BRL" ? 1
    : mode[side] === "manual" ? manual[side] : quotes[side]?.rate ?? null;
  function render() {
    const left = rate("clt"), right = rate("pj");
    for (const side of ["clt", "pj"] as const) {
      const note = $(`br-${side}-source`);
      note.textContent = currency[side] === "BRL" ? "BRL"
        : mode[side] === "manual" ? t().manual
        : quotes[side] ? `${quotes[side].source} · ${quotes[side].date ?? ""}${quotes[side].stale ? ` · ${t().stale}` : ""}` : "—";
    }
    const result = $("br-result");
    if (!rules || !input.cltMonthly || !input.pjMonthly || !left || !right
        || !Number.isFinite(hours.clt) || !Number.isFinite(hours.pj)
        || hours.clt < 1 || hours.pj < 1 || hours.clt > 168 || hours.pj > 168) {
      result.textContent = rulesError ? t().error
        : !input.cltMonthly || !input.pjMonthly ? t().empty : t().unavailable;
      return;
    }
    const calculated = compareBrazil({ ...input,
      cltMonthly: input.cltMonthly * left, variableMonthly: input.variableMonthly * left,
      plrAnnual: input.plrAnnual * left, mealDaily: input.mealDaily * left,
      healthMonthly: input.healthMonthly * left, cltOtherBenefitsMonthly: input.cltOtherBenefitsMonthly * left,
      cltDeductionsAnnual: input.cltDeductionsAnnual * left,
      pjMonthly: input.pjMonthly * right, pjBenefitsMonthly: input.pjBenefitsMonthly * right,
      accountantMonthly: input.accountantMonthly * right, businessAnnual: input.businessAnnual * right,
      insuranceMonthly: input.insuranceMonthly * right, proLaboreMonthly: input.proLaboreMonthly * right,
      previousRevenue: input.previousRevenue * right, previousPayroll: input.previousPayroll * right,
      foreignFeeFixed: input.foreignFeeFixed * right }, rules);
    if (!calculated) { result.textContent = t().unavailable; return; }
    const warnings = [...calculated.clt.warnings, ...calculated.pj.warnings];
    const blocking = warnings.some(key => ["simples_limit", "simples_sublimit", "iss_required", "presumed_high_revenue", "high_income_review", "company_deficit"].includes(key));
    const lines = ["gross", "benefits", "payrollTax", "incomeTax", "corporateTax", "expenses", "fgts", "cash", "annualAdjustment", "adjustedCash", "package"] as const;
    const name = { gross: t().gross, benefits: t().benefits, payrollTax: t().payrollTax,
      incomeTax: t().incomeTax, corporateTax: t().corporateTax, expenses: t().expenses,
      fgts: t().fgtsRow, cash: t().cash, annualAdjustment: t().adjustment,
      adjustedCash: t().net, package: t().package };
    const formula = { gross: "<math><mi>G</mi><mo>=</mo><mn>12</mn><mi>M</mi><mo>+</mo><mi>V</mi><mo>+</mo><mi>X</mi></math>",
      benefits: "<math><mi>B</mi><mo>=</mo><mo>∑</mo><msub><mi>b</mi><mi>i</mi></msub></math>",
      payrollTax: "<math><mi>P</mi><mo>=</mo><mo>∑</mo><msub><mi>INSS</mi><mi>i</mi></msub></math>",
      incomeTax: "<math><mi>I</mi><mo>=</mo><msub><mi>IR</mi><mi>anual</mi></msub><mo>+</mo><msub><mi>IR</mi><mi>exclusivo</mi></msub></math>",
      corporateTax: "<math><mi>T</mi><mo>=</mo><mo>∑</mo><msub><mi>tributo</mi><mi>i</mi></msub></math>",
      expenses: "<math><mi>E</mi><mo>=</mo><mo>∑</mo><msub><mi>custo</mi><mi>i</mi></msub></math>",
      fgts: "<math><mi>F</mi><mo>=</mo><mn>0.08</mn><mo>×</mo><mi>base</mi></math>",
      cash: "<math><mi>C</mi><mo>=</mo><mi>G</mi><mo>−</mo><mi>P</mi><mo>−</mo><mi>T</mi><mo>−</mo><mi>E</mi><mo>−</mo><msub><mi>I</mi><mi>retido</mi></msub></math>",
      annualAdjustment: "<math><mi>A</mi><mo>=</mo><msub><mi>IR</mi><mi>devido</mi></msub><mo>−</mo><msub><mi>IR</mi><mi>retido</mi></msub></math>",
      adjustedCash: "<math><mi>L</mi><mo>=</mo><mi>C</mi><mo>−</mo><mi>A</mi></math>",
      package: "<math><mi>Q</mi><mo>=</mo><mi>L</mi><mo>+</mo><mi>B</mi><mo>+</mo><mi>pF</mi></math>" };
    const formulaInfo = getLanguage() === "pt" ? {
      gross: "CLT: 12 salários, 13º, adicional de férias e PLR. PJ: notas dos meses faturados.",
      benefits: "Soma anual dos benefícios informados.", payrollTax: "INSS calculado por competência e faixas.",
      incomeTax: "IR da oferta sobre a declaração anual, mais tributação exclusiva do 13º e PLR.",
      corporateTax: "DAS do Simples ou IRPJ, CSLL, PIS, Cofins, ISS e INSS patronal do Presumido.",
      expenses: "Contador, seguro, tarifas e outros custos.", fgts: "Depósito patronal de 8% sobre a base salarial.",
      cash: "Caixa recebido no ano após retenções e custos.",
      annualAdjustment: "Diferença entre IR anual devido e IR já retido.",
      adjustedCash: "Caixa após o ajuste da declaração anual.",
      package: "Caixa ajustado, benefícios e parcela escolhida do FGTS." } : {
      gross: "CLT: 12 salaries, 13th pay, vacation bonus and profit sharing. PJ: invoiced months.",
      benefits: "Annual sum of entered benefits.", payrollTax: "Social security by month and bracket.",
      incomeTax: "Offer's incremental annual income tax, plus separate 13th pay and profit-sharing tax.",
      corporateTax: "Simples DAS or Presumed Profit corporate and municipal taxes.",
      expenses: "Accountant, insurance, exchange fees and other costs.", fgts: "Employer's 8% deposit on the salary base.",
      cash: "Cash received during the year after withholding and costs.",
      annualAdjustment: "Annual tax due minus income tax already withheld.",
      adjustedCash: "Cash after the annual tax return adjustment.",
      package: "Adjusted cash, benefits and selected share of FGTS." };
    const cell = (value: number) => `<span class="mono">${brl(value)}</span>`;
    result.innerHTML = `${blocking ? `<p class="br-warning">${t().unavailable}</p>` : `<div class="br-head" data-trend="${calculated.winner === "tie" ? "neutral" : "up"}"><strong>${t().winner}: ${calculated.winner === "tie" ? "=" : calculated.winner.toUpperCase()}</strong><span class="br-big mono">${calculated.percent === null ? "—" : number(calculated.percent) + "%"}</span><span>${t().delta}: ${brl(Math.abs(calculated.delta))}</span><span>${t().monthly}: ${brl(Math.abs(calculated.delta) / 12)}</span></div>`}<div class="br-table"><div class="br-row br-column"><strong></strong><strong>CLT</strong><strong>PJ · ${calculated.pj.regime}</strong><strong>Δ PJ − CLT</strong></div>${lines.map(key => {
      const a = calculated.clt[key], b = calculated.pj[key];
      const delta = b - a;
      const group = key === "gross" ? `<div class="br-section">${t().revenueGroup}</div>`
        : key === "payrollTax" ? `<div class="br-section">${t().taxGroup}</div>`
        : key === "fgts" ? `<div class="br-section">${t().resultGroup}</div>` : "";
      const displayFormula = formula[key].replace("<math>", "<math><mrow>").replace("</math>", "</mrow></math>");
      return `${group}<div class="br-row ${["package", "adjustedCash"].includes(key) ? "br-total" : ""}"><span>${name[key]} <button type="button" class="br-help" data-help="${key}" aria-label="Formula" aria-expanded="false">?</button><span id="br-tip-${key}" class="br-tooltip" role="tooltip" hidden>${displayFormula}<br>${formulaInfo[key]}</span></span>${cell(a)}${cell(b)}<span class="mono" data-trend="${delta > 0 ? "up" : delta < 0 ? "down" : "neutral"}">${delta > 0 ? "↑" : delta < 0 ? "↓" : "="} ${brl(Math.abs(delta))}</span></div>`;
    }).join("")}</div>${warnings.map((key, index) => `<p class="br-warning"><button type="button" class="br-help br-alert" data-help="warning-${index}" aria-label="${getLanguage() === "pt" ? "Aviso" : "Warning"}" aria-expanded="false">!</button><span id="br-tip-warning-${index}" class="br-tooltip" role="tooltip" hidden>${t()[key as keyof ReturnType<typeof t>] ?? key}</span>${t()[key as keyof ReturnType<typeof t>] ?? key}</p>`).join("")}`;
    const source = $("br-source");
    source.textContent = `${t().source} · ${rules.source} · ${rules.checked_at} · `;
    for (const [name, url] of Object.entries(rules.sources)) {
      try {
        const link = new URL(url);
        if (link.protocol !== "https:") continue;
        const anchor = document.createElement("a");
        anchor.href = link.href; anchor.target = "_blank"; anchor.rel = "noopener noreferrer";
        anchor.textContent = name.toUpperCase(); source.append(anchor, " · ");
      } catch { /* A malformed source cannot enter the link list. */ }
    }
    $("br-announcement").textContent = blocking ? t().unavailable : `${t().winner}: ${calculated.winner}`;
  }
  async function fetchRules() {
    if (loadingRules) return;
    loadingRules = true;
    try {
      const response = await fetch("/api/br/tax-rules?year=2026");
      if (!response.ok) throw new Error("rules");
      const parsed = taxRulesSchema.safeParse(await response.json() as unknown);
      if (!parsed.success) throw new Error("rules");
      rules = parsed.data;
      rulesError = false;
    } catch { rulesError = true; }
    loadingRules = false;
    render();
  }
  async function fetchRates() {
    const current = ++request;
    for (const side of ["clt", "pj"] as const) {
      if (currency[side] === "BRL" || mode[side] === "manual") continue;
      const base = currency[side];
      try {
        const response = await fetch(`/api/br/rate?${new URLSearchParams({ base })}`);
        if (!response.ok) throw new Error("rate");
        const parsed = rateSchema.safeParse(await response.json() as unknown);
        if (!parsed.success || parsed.data.base !== base || parsed.data.quote !== "BRL") throw new Error("rate");
        if (current === request) quotes[side] = parsed.data;
      } catch { if (current === request) quotes[side] = null; }
    }
    if (current === request) render();
  }
  panel.addEventListener("input", event => {
    const target = event.target;
    if (!(target instanceof window.HTMLInputElement)) return;
    if (target.dataset.money) {
      const key = target.dataset.money as MoneyKey;
      const formatted = formatSalaryText(target.value, target.selectionStart ?? target.value.length, locale());
      if (formatted && formatted.text !== target.value) {
        target.value = formatted.text; target.setSelectionRange(formatted.cursor, formatted.cursor);
      }
      const value = formatted?.value ?? 0;
      const side = key === "cltMonthly" ? "clt" : key === "pjMonthly" ? "pj" : null;
      input[key] = side ? period[side] === "monthly" ? value
        : period[side] === "annual" ? value / 12 : value * hours[side] * 52 / 12 : value;
    } else if (target.dataset.number) {
      const key = target.dataset.number as "fgtsShare" | "mealDays" | "dependents" | "pjVacationDays" | "pjPaidVacationDays" | "issRate" | "foreignFeeRate";
      input[key] = Number(target.value) / (["fgtsShare", "issRate", "foreignFeeRate"].includes(key) ? 100 : 1);
    } else if (target.dataset.manual) {
      const side = target.dataset.manual as "clt" | "pj";
      manual[side] = parseAmount(target.value, locale());
    } else if (target.dataset.hours) {
      const side = target.dataset.hours as "clt" | "pj";
      hours[side] = Number(target.value);
    }
    render();
  });
  panel.addEventListener("change", event => {
    const target = event.target;
    if (!(target instanceof window.HTMLInputElement || target instanceof window.HTMLSelectElement)) return;
    if (target.dataset.period) {
      const side = target.dataset.period as "clt" | "pj";
      if (target.value === "hourly" || target.value === "monthly" || target.value === "annual") {
        period[side] = target.value;
        $<HTMLInputElement>(`br-${baseKey(side)}`).value = input[baseKey(side)] ? number(displayed(side)) : "";
      }
    } else if (target.dataset.currency) { currency[target.dataset.currency as "clt" | "pj"] = target.value; quotes[target.dataset.currency as "clt" | "pj"] = null; fetchRates(); }
    else if (target.dataset.rateMode) {
      const side = target.dataset.rateMode as "clt" | "pj";
      mode[side] = target.value === "manual" ? "manual" : "auto";
      $<HTMLInputElement>(`br-${side}-manual`).hidden = mode[side] === "auto";
      fetchRates();
    } else if (target.id === "br-regime") input.regime = target.value === "presumido" ? "presumido" : "simples";
    else if (target.id === "br-export") input.exportServices = target.value === "true";
    render();
  });
  panel.addEventListener("click", event => {
    const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>("[data-help]") : null;
    if (!button) return;
    const tip = $(`br-tip-${button.dataset.help}`);
    const next = tip.hidden;
    panel.querySelectorAll<HTMLElement>(".br-tooltip").forEach(item => { item.hidden = true; });
    panel.querySelectorAll<HTMLButtonElement>(".br-help").forEach(item => item.setAttribute("aria-expanded", "false"));
    tip.hidden = !next;
    button.setAttribute("aria-expanded", String(next));
  });
  panel.addEventListener("keydown", event => {
    if (event.key === "Escape") {
      panel.querySelectorAll<HTMLElement>(".br-tooltip").forEach(item => { item.hidden = true; });
      panel.querySelectorAll<HTMLButtonElement>(".br-help").forEach(item => item.setAttribute("aria-expanded", "false"));
    }
  });
  build();
  fetchRules();
  return { setLanguage: build, refreshCurrencies,
    activate: () => { if (!rules) fetchRules(); fetchRates(); render(); } };
}
