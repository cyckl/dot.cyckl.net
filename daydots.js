// Day Dots: for every item on the shelf-life chart, the day dot it gets if
// thawed, opened or prepped right now. Standalone version of the Day Dots tab
// from the Jamba Planner (cleaning-rota).

// ---------- Small helpers ----------

const $ = (sel) => document.querySelector(sel);

function esc(s) {
	return String(s ?? "").replace(
		/[&<>"']/g,
		(c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
	);
}

async function loadJSON(path) {
	const res = await fetch(path, { cache: "no-store" });
	if (!res.ok) throw new Error(`Could not load ${path} (${res.status})`);
	return res.json();
}

// "%a, %-m/%-d" → "Wed, 11/18". Accepts a Date or an ISO "YYYY-MM-DD" string.
function shortDate(value) {
	const d = typeof value === "string" ? new Date(...value.split("-").map((n, i) => Number(n) - (i === 1 ? 1 : 0))) : value;
	const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getDay()];
	return `${weekday}, ${d.getMonth() + 1}/${d.getDate()}`;
}

// ---------- Day Dots ----------


const dd = { data: null, filter: "all", query: "", timer: null, expanded: new Set() };
const DD_DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const STORAGE_LABEL = { fridge: "Fridge", dry: "Dry", freezer: "Freezer" };

/**
 * Use-by moment for something started at `now`.
 * - hours:  exact time (now + N hours)
 * - days:   through the END of day today + N (prep Sunday, 3 days → good through Wednesday)
 * - months: through the end of the same date N months later (clamped, e.g. Jan 31 + 1 → Feb 28)
 */
function useBy(now, life) {
	if (life.unit === "hours") return { date: new Date(now.getTime() + life.amount * 3600e3), exact: true };
	if (life.unit === "days") {
		return { date: new Date(now.getFullYear(), now.getMonth(), now.getDate() + life.amount, 23, 59), exact: false };
	}
	const target = new Date(now.getFullYear(), now.getMonth() + life.amount, 1);
	const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
	target.setDate(Math.min(now.getDate(), lastDay));
	target.setHours(23, 59);
	return { date: target, exact: false };
}

/** Lowercase and strip accents, for forgiving search ("Açaí" → "acai"). */
const fold = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * Does `text` contain the query, ignoring plural vs singular? A plural query
 * also tries its singular ("strawberries" → "strawberry", "mangos" → "mango");
 * a singular query already matches inside the plural.
 */
function wordForms(q) {
	const forms = [q];
	if (q.length > 3 && q.endsWith("ies")) forms.push(q.slice(0, -3) + "y");
	else if (q.length > 3 && q.endsWith("es")) forms.push(q.slice(0, -2), q.slice(0, -1));
	else if (q.length > 2 && q.endsWith("s")) forms.push(q.slice(0, -1));
	return forms;
}

function matches(text, q) {
	return wordForms(q).some((f) => text.includes(f));
}

/** Word with its plural/singular ending removed, so "strawberry" and "strawberries" share "strawberr". */
const stem = (w) => (w.length > 4 ? w.replace(/(ies|es|s|y)$/, "") : w);

const lifeLabel = ({ amount, unit }) => `${amount} ${amount === 1 ? unit.replace(/s$/, "") : unit}`;

function clockLabel(d) {
	const h = d.getHours();
	const m = d.getMinutes();
	return `${h % 12 || 12}${m ? ":" + String(m).padStart(2, "0") : ""}${h < 12 ? "a" : "p"}`;
}

/** Black or white text, whichever reads better on the sticker colour. */
function inkFor(hex) {
	const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
	return 0.299 * r + 0.587 * g + 0.114 * b > 0.6 ? "#111" : "#fff";
}

/**
 * A picture of the physical sticker: octagon, weekday on a coloured band,
 * use-by date underneath. `title` becomes the hover tooltip.
 */
function sticker(date, { size = "", title = "" } = {}) {
	const day = DD_DAYS[date.getDay()];
	const c = dd.data.dotColors[day];
	return `<span class="sticker${size ? " " + size : ""}" style="--dot:${c.hex};--dot-ink:${inkFor(c.hex)}" title="${esc(title || `${c.name} (${day})`)}" role="img" aria-label="${esc(`${c.name} ${day} day dot, ${date.getMonth() + 1}/${date.getDate()}`)}">
		<span class="sticker-face">
			<span class="sticker-day">${day.toUpperCase()}</span>
			<span class="sticker-date">${date.getMonth() + 1}/${date.getDate()}</span>
		</span>
	</span>`;
}

function renderDayDots() {
	if (!dd.data) return;
	const now = new Date();
	$("#dd-now").textContent = `${shortDate(now)} · ${clockLabel(now)}`;

	// Reference strip: today and the next 7 days with their sticker colours.
	$("#dd-strip").innerHTML = Array.from({ length: 8 }, (_, i) => {
		const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
		const c = dd.data.dotColors[DD_DAYS[d.getDay()]];
		return `<div class="dd-day${i === 0 ? " today" : ""}">
			${sticker(d, { size: "small" })}
			<span class="dd-day-date">${i === 0 ? "Today" : `+${i}`}</span>
			<span class="muted">${esc(c.name)}</span>
		</div>`;
	}).join("");

	// Products this store uses, each with its active steps (thawed → opened, etc.).
	// Search matches the name, detail, category, step labels and aliases (e.g. "apple"
	// finds Hand Mixed Juices via its "Apple Strawberry" alias). Accents are ignored,
	// so "acai" finds "Açaí".
	const q = fold(dd.query.trim());
	// Store nicknames ("oj", "pango") also search for the full name they stand for.
	const nickname = q && wordForms(q).map((f) => dd.data.searchNicknames?.[f]).find(Boolean); // "pitayas" → "pitaya"
	const queries = q ? [q, ...(nickname ? [fold(nickname)] : [])] : [];
	const hit = (text) => queries.some((v) => matches(text, v));
	const items = dd.data.items
		.filter((it) => !it.disabled)
		.map((it) => ({ ...it, steps: it.steps.filter((s) => !s.disabled).map((s) => ({ ...s, due: useBy(now, s.life) })) }))
		.filter((it) => it.steps.length)
		.filter((it) => dd.filter === "all" || it.storage === dd.filter)
		// aliasHits = keywords that explain the match; skipped when the name itself already shows it.
		.map((it) => ({
			...it,
			aliasHits: q && !queries.some((v) => fold(it.name).includes(stem(v))) ? (it.aliases ?? []).filter((a) => hit(fold(a))) : [],
		}))
		.map((it) => ({ ...it, aliasHit: q && (it.aliases ?? []).some((a) => hit(fold(a))) }))
		.filter((it) => !q || it.aliasHit || hit(fold([it.name, it.detail, it.category, ...it.steps.map((s) => s.label)].join(" "))));

	// All of a product's stages share one column, read left to right.
	$("#dd-table thead").innerHTML = `<tr><th>Item</th><th class="dd-steps">Day dots</th></tr>`;

	// Group in chart order; anything with an unlisted category goes last.
	const order = [...dd.data.categories, ...new Set(items.map((it) => it.category).filter((c) => !dd.data.categories.includes(c)))];
	const groups = order
		.map((cat) => [cat, items.filter((it) => it.category === cat).sort((a, b) => a.name.localeCompare(b.name) || a.storage.localeCompare(b.storage))])
		.filter(([, list]) => list.length);

	$("#dd-empty").hidden = groups.length > 0;
	$("#dd-table tbody").innerHTML = groups
		.map(
			([cat, list]) =>
				`<tr class="dd-group"><th colspan="2">${esc(cat)}</th></tr>` +
				list
					.map(
						(it) => {
							const open = dd.expanded.has(it.id);
							return `<tr class="dd-item${open ? " open" : ""}" data-id="${esc(it.id)}" tabindex="0" role="button" aria-expanded="${open}">
					<td colspan="2">
						<div class="dd-row">
							<div class="dd-name">
								<b>${esc(it.name)}</b> <span class="tag day">${STORAGE_LABEL[it.storage]}</span>
								${it.aliasHits.length ? `<div class="small dd-alias">Includes ${it.aliasHits.map(esc).join(", ")}</div>` : ""}
							</div>
							<div class="dd-step-row">${it.steps.map((s, i) => stepCell(s, i, it.steps.length > 1)).join("")}</div>
						</div>
					</td>
				</tr>${open ? detailRow(it, 2) : ""}`;
						},
					)
					.join(""),
		)
		.join("");
}

/** Expanded details under a product: each step's trigger, shelf life, use-by and notes. */
function detailRow(it, colspan) {
	const steps = it.steps
		.map(
			(s, i) => `<li>
				<div class="dd-detail-step">${i === 0 ? "Day dot" : "Replacement dot"}: <b>${esc(s.label)}</b></div>
				<div>Shelf life <b>${lifeLabel(s.life)}</b> · use by <b>${shortDate(s.due.date)}</b> ${s.due.exact ? `at ${clockLabel(s.due.date)}` : "(end of day)"}</div>
				${s.note ? `<div class="muted">${esc(s.note)}</div>` : ""}
			</li>`,
		)
		.join("");
	const includes = it.detail ? `<div class="dd-includes"><span class="muted">Includes</span> ${esc(it.detail)}</div>` : "";
	return `<tr class="dd-detail"><td colspan="${colspan}">${includes}<ol>${steps}</ol></td></tr>`;
}

function toggleItem(id) {
	dd.expanded.has(id) ? dd.expanded.delete(id) : dd.expanded.add(id);
	renderDayDots();
	document.querySelector(`#dd-table tr.dd-item[data-id="${CSS.escape(id)}"]`)?.focus();
}

/** One step of a product's life: dot, use-by date, and what starts the clock. */
/**
 * Short name for a stage, shown under its dot: the step's `short` if set,
 * otherwise its first word ("Thawed in walk-in" → "Thawed").
 */
const stageName = (step) => step.short ?? step.label.split(/\s+/)[0];

function stepCell(step, index, labelled) {
	// The sticker, plus the stage name under it when a product has more than one stage.
	// Full details are in the expanded row (and the hover tooltip).
	const details = [
		`${step.label} · ${lifeLabel(step.life)}`,
		`Use by ${shortDate(step.due.date)} ${step.due.exact ? clockLabel(step.due.date) : "(end of day)"}`,
		step.note,
	]
		.filter(Boolean)
		.join("\n");
	const dot =
		step.dayDot === false
			? `<span class="sticker-none" title="${esc(details)}\n(Chart doesn't call for a day dot)">—</span>`
			: sticker(step.due.date, { title: details });
	return `<figure class="dd-stage">
			${dot}
			${labelled ? `<figcaption>${esc(stageName(step))}</figcaption>` : ""}
		</figure>`;
}

async function initDayDots() {
	if (dd.data) return;
	try {
		dd.data = await loadJSON("data/daydots.json");
		$("#dd-source").textContent = dd.data.source;
	} catch (err) {
		$("#dd-empty").hidden = false;
		$("#dd-empty").textContent = `Couldn't load data/daydots.json: ${err.message}`;
		return;
	}
	document.querySelectorAll("#dd-filters button").forEach((b) =>
		b.addEventListener("click", () => {
			dd.filter = b.dataset.filter;
			document.querySelectorAll("#dd-filters button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
			renderDayDots();
		}),
	);
	$("#dd-search").addEventListener("input", (e) => {
		dd.query = e.target.value;
		renderDayDots();
	});
	// Rows are re-rendered every minute, so listen once on the table body.
	const body = $("#dd-table tbody");
	body.addEventListener("click", (e) => {
		const row = e.target.closest("tr.dd-item");
		if (row) toggleItem(row.dataset.id);
	});
	body.addEventListener("keydown", (e) => {
		const row = e.target.closest("tr.dd-item");
		if (row && (e.key === "Enter" || e.key === " ")) {
			e.preventDefault();
			toggleItem(row.dataset.id);
		}
	});
}

/** Called when the tab is shown or hidden; keeps "now" fresh while visible. */
async function setDayDotsVisible(visible) {
	clearInterval(dd.timer);
	if (!visible) return;
	await initDayDots();
	renderDayDots();
	dd.timer = setInterval(renderDayDots, 60e3);
}

// ---------- Start ----------

setDayDotsVisible(true).catch((err) => {
	$("#dd-empty").hidden = false;
	$("#dd-empty").textContent =
		err.message + (location.protocol === "file:" ? "\n\nOpen this through a local web server (see README.md), not by double-clicking." : "");
});
