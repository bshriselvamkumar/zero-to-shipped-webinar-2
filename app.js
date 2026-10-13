/* 0 to Shipped — resume parser
   Reads a PDF locally with pdf.js, then scores the extracted text
   against a fixed skill list. No server, no upload, no network calls
   other than the pdf.js library itself. */

/* ---------- 1. What we look for ------------------------------------------
   `aliases` are the spellings we accept in the text; the key is what we
   show. core skills are worth more than nice-to-haves, which is what
   makes the score reflect a real resume rather than a keyword dump. */

const SKILLS = [
  {
    group: "Languages",
    items: [
      { name: "JavaScript", core: true, aliases: ["javascript", "js", "es6", "ecmascript"] },
      { name: "TypeScript", core: true, aliases: ["typescript", "ts"] },
      { name: "Python", core: true, aliases: ["python"] },
      { name: "Java", aliases: ["java"] },
      { name: "C#", aliases: ["c#", "csharp", "c sharp"] },
      { name: "C++", aliases: ["c++", "cpp"] },
      { name: "Go", aliases: ["golang", "go lang"] },
      { name: "SQL", core: true, aliases: ["sql", "postgres", "postgresql", "mysql"] },
    ],
  },
  {
    group: "Frontend",
    items: [
      { name: "React", core: true, aliases: ["react", "react.js", "reactjs"] },
      { name: "Next.js", aliases: ["next.js", "nextjs"] },
      { name: "Vue", aliases: ["vue", "vue.js", "vuejs"] },
      { name: "HTML", core: true, aliases: ["html", "html5"] },
      { name: "CSS", core: true, aliases: ["css", "css3", "scss", "sass", "tailwind"] },
      { name: "Responsive / a11y", aliases: ["responsive", "accessibility", "a11y", "wcag"] },
    ],
  },
  {
    group: "Backend & data",
    items: [
      { name: "Node.js", core: true, aliases: ["node.js", "nodejs", "node"] },
      { name: "REST APIs", core: true, aliases: ["rest api", "rest apis", "restful", "api design"] },
      { name: "Express", aliases: ["express", "express.js", "expressjs"] },
      { name: "Databases", core: true, aliases: ["mongodb", "mongo", "dynamodb", "database", "databases", "redis"] },
      { name: "Auth", aliases: ["oauth", "jwt", "authentication", "authorization"] },
    ],
  },
  {
    group: "Tools & practice",
    items: [
      { name: "Git", core: true, aliases: ["git", "github", "gitlab", "version control"] },
      { name: "Docker", core: true, aliases: ["docker", "container"] },
      { name: "CI/CD", aliases: ["ci/cd", "cicd", "continuous integration", "github actions", "jenkins"] },
      { name: "Cloud", core: true, aliases: ["aws", "azure", "gcp", "google cloud", "vercel", "netlify", "cloud"] },
      { name: "Testing", aliases: ["jest", "vitest", "pytest", "unit test", "unit tests", "testing", "cypress", "playwright"] },
      { name: "Agile / teamwork", aliases: ["agile", "scrum", "kanban", "code review"] },
    ],
  },
];

/* How many "core" points a resume needs before it scores 100.
   Tuned so a solid junior profile lands in the 70–90 band. */
const TARGET_POINTS = 12;

/* ---------- 2. Text -> skills ------------------------------------------- */

/** Lowercase, straighten punctuation and squash whitespace so that
 *  "React.JS\n" and "react.js " both match the same alias. */
function normalize(text) {
  return text
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\u2013|\u2014/g, "-")
    .replace(/\s+/g, " ");
}

/** Whole-token match: the alias must not be part of a longer word,
 *  so "java" doesn't fire on "javascript", but "c++" still works. */
function hasAlias(text, alias) {
  const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(?:^|[^a-z0-9+#])${escaped}(?![a-z0-9+#])`, "i");
  return re.test(text);
}

function analyze(text) {
  const haystack = normalize(text);
  const found = [];
  const missing = [];
  let earned = 0;
  let possible = 0;

  for (const { group, items } of SKILLS) {
    for (const skill of items) {
      const weight = skill.core ? 1 : 0.5;
      possible += weight;
      const hit = skill.aliases.some((a) => hasAlias(haystack, a));
      if (hit) {
        earned += weight;
        found.push({ name: skill.name, group, core: skill.core });
      } else {
        missing.push({ name: skill.name, group, core: skill.core });
      }
    }
  }

  const score = Math.min(100, Math.round((earned / TARGET_POINTS) * 100));
  return { score, found, missing, earned, possible };
}

function verdict(score) {
  if (score >= 85) return ["Shipped-ready", "Strong, broad coverage. A recruiter's keyword scan will pass this."];
  if (score >= 65) return ["Almost there", "Good core coverage — the gaps below are what a reviewer would ask about."];
  if (score >= 40) return ["Needs work", "Some signal, but too many staples are missing to survive a first pass."];
  if (score > 0) return ["Early days", "We found a little, but most of what reviewers look for isn't on the page yet."];
  return ["Nothing detected", "No known skills matched. If this is a scanned or image-only PDF, the text layer is missing."];
}

/* ---------- 3. DOM refs -------------------------------------------------- */

const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("file");
const statusEl = document.getElementById("status");
const sampleBtn = document.getElementById("sample");
const resetBtn = document.getElementById("reset");

const resultsEl = document.getElementById("results");
const ringEl = document.getElementById("ring");
const scoreValueEl = document.getElementById("score-value");
const scoreLabelEl = document.getElementById("score-label");
const scoreSummaryEl = document.getElementById("score-summary");
const scoreFileEl = document.getElementById("score-file");
const foundListEl = document.getElementById("found-list");
const missingListEl = document.getElementById("missing-list");
const foundCountEl = document.getElementById("found-count");
const missingCountEl = document.getElementById("missing-count");

const pdfjsLib = window.pdfjsLib;
if (pdfjsLib) {
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js";
}

/* ---------- 4. Reading files -------------------------------------------- */

async function extractPdf(file) {
  const buffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
  const pages = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const content = await page.getTextContent();
    pages.push(content.items.map((item) => item.str).join(" "));
  }
  return pages.join("\n");
}

async function extractText(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith(".pdf") || file.type === "application/pdf") {
    if (!pdfjsLib) {
      throw new Error("The PDF reader didn't load. Check your connection and refresh the page.");
    }
    return extractPdf(file);
  }
  if (name.endsWith(".txt") || name.endsWith(".md") || file.type.startsWith("text/")) {
    return file.text();
  }
  throw new Error("That file type isn't supported. Try a PDF, TXT or MD file.");
}

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle("is-error", isError);
}

function setBusy(busy) {
  dropzone.classList.toggle("is-busy", busy);
  dropzone.setAttribute("aria-busy", String(busy));
}

/* ---------- 5. Painting the result -------------------------------------- */

function groupChips(container, skills) {
  container.innerHTML = "";
  if (!skills.length) {
    container.classList.add("chips--empty");
    container.textContent = "Nothing in this list yet.";
    return;
  }
  container.classList.remove("chips--empty");

  const byGroup = new Map();
  for (const skill of skills) {
    if (!byGroup.has(skill.group)) byGroup.set(skill.group, []);
    byGroup.get(skill.group).push(skill);
  }

  for (const [group, items] of byGroup) {
    const label = document.createElement("span");
    label.className = "chip-group-label";
    label.textContent = group;
    container.append(label);

    for (const skill of items) {
      const chip = document.createElement("span");
      chip.className = "chip";
      chip.textContent = skill.name + (skill.core ? " ★" : "");
      container.append(chip);
    }
  }
}

function animateScore(score) {
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const duration = reduced ? 0 : 700;
  const start = performance.now();

  function frame(now) {
    const t = duration ? Math.min(1, (now - start) / duration) : 1;
    const eased = 1 - Math.pow(1 - t, 3);
    const value = Math.round(score * eased);
    scoreValueEl.textContent = value;
    ringEl.style.setProperty("--p", String(value));
    if (t < 1) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

function render({ score, found, missing }, fileName) {
  const [label, summary] = verdict(score);

  scoreLabelEl.textContent = label;
  scoreSummaryEl.textContent = summary;
  scoreFileEl.textContent = fileName
    ? `${fileName} · ${found.length} of ${found.length + missing.length} skills matched`
    : `${found.length} of ${found.length + missing.length} skills matched`;

  foundCountEl.textContent = String(found.length);
  missingCountEl.textContent = String(missing.length);
  groupChips(foundListEl, found);
  groupChips(missingListEl, missing);

  resultsEl.hidden = false;
  animateScore(score);
  resultsEl.scrollIntoView({ behavior: "smooth", block: "start" });
}

/* ---------- 6. The one entry point for a file --------------------------- */

async function handleFile(file) {
  if (!file) return;
  setBusy(true);
  setStatus(`Reading ${file.name}…`);

  try {
    const text = await extractText(file);
    if (!text.trim()) {
      throw new Error(
        "No text layer found in that PDF — it looks like a scan or an image. Export a text-based PDF and try again."
      );
    }
    const result = analyze(text);
    render(result, file.name);
    setStatus("");
  } catch (err) {
    setBusy(false);
    // pdf.js throws a recognizable name for encrypted documents.
    const message =
      err && err.name === "PasswordException"
        ? "That PDF is password-protected. Remove the password and try again."
        : (err && err.message) || "Something went wrong reading that file.";
    setStatus(message, true);
    return;
  }
  setBusy(false);
}

/* ---------- 7. Wiring --------------------------------------------------- */

dropzone.addEventListener("click", () => fileInput.click());
dropzone.addEventListener("keydown", (event) => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    fileInput.click();
  }
});

fileInput.addEventListener("change", () => {
  handleFile(fileInput.files[0]);
  fileInput.value = ""; // so re-picking the same file fires again
});

["dragenter", "dragover"].forEach((type) =>
  dropzone.addEventListener(type, (event) => {
    event.preventDefault();
    dropzone.classList.add("is-over");
  })
);

["dragleave", "drop"].forEach((type) =>
  dropzone.addEventListener(type, (event) => {
    event.preventDefault();
    dropzone.classList.remove("is-over");
  })
);

dropzone.addEventListener("drop", (event) => {
  const file = event.dataTransfer && event.dataTransfer.files[0];
  handleFile(file);
});

resetBtn.addEventListener("click", () => {
  resultsEl.hidden = true;
  setStatus("");
  fileInput.click();
});

/* ---------- 8. Sample result (for people who don't want to upload) ------- */

const SAMPLE_TEXT = `
  Priya Raman — Frontend Developer
  priya.raman@example.com · github.com/priyaraman

  EXPERIENCE
  Junior Web Developer, Northwind Studio
  Built responsive marketing pages with HTML, CSS and JavaScript.
  Shipped a React dashboard backed by a Node.js and Express REST API.
  Stored user data in PostgreSQL, handled authentication with JWT.
  Ran unit tests with Jest in a Git and GitHub Actions workflow.
  Deployed with Docker to AWS.

  SKILLS
  JavaScript, TypeScript, React, HTML, CSS, Postgres, Git, Agile, code review
`;

sampleBtn.addEventListener("click", () => {
  const result = analyze(SAMPLE_TEXT);
  render(result, "sample-resume.txt");
  setStatus("");
});

/* ---------- 9. Render the "what we look for" section -------------------- */

const skillGroupsEl = document.getElementById("skill-groups");
for (const { group, items } of SKILLS) {
  const wrapper = document.createElement("div");
  wrapper.className = "skill-group";

  const heading = document.createElement("h3");
  heading.textContent = group;

  const list = document.createElement("ul");
  for (const skill of items) {
    const li = document.createElement("li");
    li.textContent = skill.name;
    list.append(li);
  }

  wrapper.append(heading, list);
  skillGroupsEl.append(wrapper);
}
