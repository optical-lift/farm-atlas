import styles from "./recovered-task-patterns.module.css";

type Pattern = {
  title: string;
  era: string;
  source: string;
  why: string;
  pieces: string[];
  preview: "cockpit" | "ticket" | "chips" | "tools" | "checklist" | "check" | "dominion" | "weed" | "move" | "title" | "results";
};

const patterns: Pattern[] = [
  {
    title: "Purple task cockpit",
    era: "July 4",
    source: "39e9e448 + surrounding July 4 iterations",
    why: "A full-width task-first hero that made the next physical move feel obvious without turning the home screen into a task manager.",
    pieces: [
      "Purple full-width hero",
      "Small Next / Watch cards above the active move",
      "Active task as the large tappable center",
      "One-line purpose under the task",
      "Quiet footer for queue / needs-data / next-pass context",
    ],
    preview: "cockpit",
  },
  {
    title: "Farm ticket + rhythm-first card",
    era: "July 5–6",
    source: "1b3d92b9 + July 6 rhythm refinements",
    why: "The card read like a field slip: subject, physical verb, place, and timing rather than engine vocabulary.",
    pieces: [
      "Rhythm pill",
      "Farm subject as the title",
      "Unlabeled physical verb such as Sow, Weed, Harvest, Paint",
      "No Action: label and no priority language",
      "Task-specific detail heading instead of universal boilerplate",
    ],
    preview: "ticket",
  },
  {
    title: "Place-led chips",
    era: "July 5",
    source: "407ced76",
    why: "The active card put the real farm place ahead of duplicate metadata and made multi-bed work immediately scannable.",
    pieces: [
      "Zone name as the strong place heading",
      "Individual beds / rows as compact chips",
      "Up Now retained as a light orientation cue",
      "Where / When boxes removed when they merely repeated the same facts",
    ],
    preview: "chips",
  },
  {
    title: "Compact location + spacing pills",
    era: "July 6",
    source: "e2f5d875",
    why: "Tiny, persistent agronomic facts lived near the top of the card instead of being buried in prose.",
    pieces: [
      "Location pill in the task header rail",
      "Dedicated Spacing card",
      "Spacing values rendered as quick chips",
      "Checklist placed directly after the agronomic facts",
    ],
    preview: "chips",
  },
  {
    title: "Tools get their own spot",
    era: "July 6",
    source: "7ee03382 + a1c09370",
    why: "Equipment stopped being repeated inside every checklist instruction and became a clean, reusable resource strip.",
    pieces: [
      "Separate Tools section",
      "Equipment rendered as pills",
      "Procedure text cleaned of repeated mower/tool names",
      "Empty or irrelevant task-detail blocks removed",
    ],
    preview: "tools",
  },
  {
    title: "Fully visible execution checklist",
    era: "August 4",
    source: "e05b5d78",
    why: "A multi-step job could be run directly from the card without opening nested task children one by one.",
    pieces: [
      "Checklist is fully exposed on the main card",
      "Steps grouped under human section labels",
      "Large tap targets with visible checked state",
      "Progress count in the checklist header",
      "Completion remains gated by the required physical steps",
    ],
    preview: "checklist",
  },
  {
    title: "Check cards branch by what is true",
    era: "July 13–14",
    source: "31337911 + germination follow-ups",
    why: "The germination card replaced generic Done / Unfinished with the observation that actually determines the next farm move.",
    pieces: [
      "Farm-facing heading instead of engine labels",
      "Crop history drawer attached to the check",
      "Good / spotty / poor stand choices",
      "Not yet is a valid result that schedules another observation",
      "The result can release a different next task rather than merely close this one",
    ],
    preview: "check",
  },
  {
    title: "One continuous Dominion card",
    era: "July 26",
    source: "d3bb7835",
    why: "Place, Trail, current move, why-now, operating facts, procedure, evidence, and result became one object instead of separate panels.",
    pieces: [
      "Place first",
      "Dot-and-line Trail embedded in the card",
      "Current move visually emphasized",
      "Why this is active / this move changes",
      "Compact operating facts",
      "Result area belongs to the same card",
    ],
    preview: "dominion",
  },
  {
    title: "Weed field sheet + pass logging",
    era: "July 28",
    source: "8b5a52f6 + cc0ffe84",
    why: "Persistent maintenance work stopped pretending that one work session necessarily finishes the underlying need.",
    pieces: [
      "Quiet three-node Trail around the current move",
      "Literal Weed [bed] directive",
      "One continuous field sheet with no nested Weed panel",
      "Log a pass records changed condition without closing the day",
      "That’s all for today closes only the current serving",
    ],
    preview: "weed",
  },
  {
    title: "Compact Move drawer",
    era: "July 29",
    source: "45138db2",
    why: "Rescheduling stayed available without occupying the task’s primary finish area.",
    pieces: [
      "Single quiet Move row",
      "Tomorrow shortcut",
      "Choose-date control",
      "Actual return date shown",
      "Clock decides the governed consequence of moving it",
    ],
    preview: "move",
  },
  {
    title: "Task title opens; chevron peeks",
    era: "July 29",
    source: "faa74d77",
    why: "One tap on the task name opened the canonical full card while the small chevron remained a lightweight inline reveal.",
    pieces: [
      "Title is a direct link to the full task",
      "Chevron has only one job: expand the inline preview",
      "No ambiguous whole-row click behavior",
    ],
    preview: "title",
  },
  {
    title: "Familiar worker results, richer card underneath",
    era: "July 21–26",
    source: "Anna-facing handoff + Dominion refinement",
    why: "The information could get richer without making the worker’s final decision language feel like task administration.",
    pieces: [
      "Primary controls stay Done and Unfinished",
      "Unfinished can expose Partly done / Blocked",
      "Move or close this card stays a separate secondary area",
      "Worker reports physical reality; Atlas handles task machinery underneath",
    ],
    preview: "results",
  },
];

function Preview({ kind }: { kind: Pattern["preview"] }) {
  if (kind === "cockpit") {
    return (
      <div className={`${styles.preview} ${styles.cockpit}`}>
        <div className={styles.previewMiniRow}><span>Next · Weed FR13</span><span>Watch · BB4</span></div>
        <strong>Mow U-Pick walkways</strong>
        <small>U-Pick · return the guest route to 3 in</small>
        <div className={styles.previewFooter}><span>4 tasks</span><span>1 needs data</span><span>Field Rows next</span></div>
      </div>
    );
  }

  if (kind === "ticket") {
    return (
      <div className={styles.preview}>
        <div className={styles.pill}>Morning</div>
        <strong>ProCut White Lite</strong>
        <b>Sow</b>
        <small>Field Row 6 · 3 rows · 4 in</small>
      </div>
    );
  }

  if (kind === "chips") {
    return (
      <div className={styles.preview}>
        <strong>Field Rows</strong>
        <div className={styles.chips}><span>FR13</span><span>FR14</span><span>FR15</span><span>4 in spacing</span></div>
      </div>
    );
  }

  if (kind === "tools") {
    return (
      <div className={styles.preview}>
        <label>Tools</label>
        <div className={styles.chips}><span>Riding mower</span><span>Weed whacker</span><span>Leaf blower</span></div>
      </div>
    );
  }

  if (kind === "checklist") {
    return (
      <div className={styles.preview}>
        <div className={styles.previewHead}><label>Closing round</label><small>2 / 4</small></div>
        <div className={styles.checkRows}><span className={styles.checked}>✓ Fill water dispenser</span><span className={styles.checked}>✓ Set coffee bar</span><span>○ Sweep dining room</span><span>○ Put out signs</span></div>
      </div>
    );
  }

  if (kind === "check") {
    return (
      <div className={styles.preview}>
        <label>Stand · How did it come up?</label>
        <div className={styles.choiceGrid}><span>Good stand</span><span>Spotty</span><span>Poor</span><span>Not yet</span></div>
      </div>
    );
  }

  if (kind === "dominion") {
    return (
      <div className={styles.preview}>
        <strong>Field Row 13</strong>
        <div className={styles.dotTrail}><i className={styles.doneDot} /><i className={styles.doneDot} /><i className={styles.nowDot} /><i /><i /></div>
        <b>Weed until the crop is readable</b>
        <div className={styles.factPair}><span><small>Why now</small>Visibility lost</span><span><small>This changes</small>Stand becomes readable</span></div>
      </div>
    );
  }

  if (kind === "weed") {
    return (
      <div className={styles.preview}>
        <div className={styles.dotTrail}><i className={styles.doneDot} /><i className={styles.nowDot} /><i /></div>
        <strong>Weed Field Row 13</strong>
        <div className={styles.previewActions}><span>Log a pass</span><span>That’s all for today</span></div>
      </div>
    );
  }

  if (kind === "move") {
    return (
      <div className={styles.preview}>
        <div className={styles.moveRow}><span>Move</span><b>⌄</b></div>
        <div className={styles.previewActions}><span>Tomorrow</span><span>Choose date</span></div>
      </div>
    );
  }

  if (kind === "title") {
    return (
      <div className={styles.preview}>
        <div className={styles.titleRow}><strong>Stake Field Rows</strong><span>⌄</span></div>
        <small>Title → full card · chevron → quick reveal</small>
      </div>
    );
  }

  return (
    <div className={styles.preview}>
      <div className={styles.resultRow}><span className={styles.doneAction}>Done</span><span>Unfinished</span></div>
      <div className={styles.moveRow}><span>Move or close this card</span><b>⌄</b></div>
    </div>
  );
}

export default function RecoveredTaskPatterns() {
  return (
    <section id="recovered-task-dna" className={styles.archive}>
      <header className={styles.archiveHeader}>
        <span>RECOVERED FROM ATLAS HISTORY</span>
        <h2>Task Card DNA</h2>
        <p>
          Older ideas that were useful enough to preserve even when the surrounding implementation changed. This is an archive, not a declaration that every piece belongs on every card.
        </p>
      </header>

      <div className={styles.patterns}>
        {patterns.map((pattern) => (
          <details className={styles.pattern} key={pattern.title}>
            <summary>
              <div>
                <strong>{pattern.title}</strong>
                <span>{pattern.era} · {pattern.source}</span>
              </div>
              <b aria-hidden="true">+</b>
            </summary>
            <div className={styles.patternBody}>
              <Preview kind={pattern.preview} />
              <p>{pattern.why}</p>
              <ul>
                {pattern.pieces.map((piece) => <li key={piece}>{piece}</li>)}
              </ul>
            </div>
          </details>
        ))}
      </div>
    </section>
  );
}
