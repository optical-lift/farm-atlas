"use client";

/**
 * Owner Day and Clock share one choreography language:
 * - committed work stays on the main rail as a white task surface;
 * - potential work is purple and branches off that rail;
 * - cues cross the rail as interruptions instead of pretending to be tasks.
 *
 * Keep this presentation-only. Canonical task/cue/placement truth remains in the
 * existing Day sequence contract.
 */
export default function OwnerDayVisualGrammar() {
  return (
    <>
      <style>{`
        /* COMMITTED — real work already in the working Day. */
        .atlas-day-timeline-group .atlas-day-task-entry > .atlas-day-task-card,
        .atlas-day-timeline-group .atlas-day-task-entry > details.atlas-day-task-card {
          background: rgba(255,255,255,.74);
          border-color: rgba(107,108,118,.16);
          box-shadow: 0 1px 0 rgba(74,69,59,.035);
        }
        .atlas-day-timeline-group .atlas-day-task-entry > .atlas-day-task-node {
          z-index: 5;
        }

        /* POTENTIAL — an Owner planning branch, never another white task. */
        .atlas-day-timeline-group .atlas-owner-day-sequence-host[data-owner-day-sequence-kind="potential_task"] {
          position: relative;
        }
        .atlas-day-timeline-group .atlas-owner-potential-day-card {
          position: relative;
          margin: 3px 0 9px 14px;
          padding: 9px 9px 10px 11px;
          border: 1px dashed rgba(116,121,177,.48);
          border-radius: 12px;
          background: linear-gradient(90deg,rgba(174,179,212,.26),rgba(238,236,248,.54) 70%,rgba(247,245,252,.30));
          box-shadow: none;
          color: #444761;
        }
        .atlas-day-timeline-group .atlas-owner-potential-day-card::before {
          content: "";
          position: absolute;
          top: 18px;
          left: -30px;
          width: 30px;
          border-top: 1px dashed rgba(116,121,177,.56);
          pointer-events: none;
        }
        .atlas-day-timeline-group .atlas-owner-potential-day-node {
          top: 14px;
          left: -39px;
          width: 8px;
          height: 8px;
          border: 1.5px dashed rgba(103,109,166,.84);
          background: #f7f4e9;
          box-shadow: 0 0 0 3px #f7f4e9;
        }
        .atlas-day-timeline-group .atlas-owner-potential-day-card[data-selected="true"] {
          border-style: solid;
          border-color: rgba(103,109,166,.52);
          background: linear-gradient(90deg,rgba(174,179,212,.38),rgba(232,229,246,.68) 72%,rgba(247,245,252,.38));
        }
        .atlas-day-timeline-group .atlas-owner-potential-day-card[data-selected="true"] .atlas-owner-potential-day-node {
          border-style: solid;
          background: #aeb3d4;
        }
        .atlas-day-timeline-group .atlas-owner-potential-day-card small {
          color: #666caa;
        }

        /* CUE — crosses the chronology. It is an interruption, not a card. */
        .atlas-day-timeline-group .atlas-owner-day-sequence-host[data-owner-day-sequence-kind="cue"] {
          position: relative;
        }
        .atlas-day-timeline-group .atlas-owner-day-cue-marker {
          position: relative;
          margin: 2px 0 10px;
          padding: 6px 0 7px 13px;
          border: 0;
          border-radius: 0;
          background: transparent;
          display: grid;
          gap: 2px;
          color: #4c5068;
          overflow: visible;
        }
        .atlas-day-timeline-group .atlas-owner-day-cue-marker::before {
          content: "";
          position: absolute;
          z-index: 0;
          top: 11px;
          left: -18px;
          right: 0;
          border-top: 1px solid rgba(91,99,137,.28);
          pointer-events: none;
        }
        .atlas-day-timeline-group .atlas-owner-day-cue-node {
          top: 8px;
          left: -22px;
          z-index: 4;
          width: 7px;
          height: 7px;
          border: 0;
          border-radius: 1px;
          background: #747b9b;
          box-shadow: 0 0 0 3px #f7f4e9;
          transform: rotate(45deg);
        }
        .atlas-day-timeline-group .atlas-owner-day-cue-marker small,
        .atlas-day-timeline-group .atlas-owner-day-cue-marker strong,
        .atlas-day-timeline-group .atlas-owner-day-cue-marker > span:not(.atlas-owner-day-cue-node) {
          position: relative;
          z-index: 1;
          width: fit-content;
          max-width: calc(100% - 8px);
          padding-right: 6px;
          background: #fbfaf4;
        }
        .atlas-day-timeline-group .atlas-owner-day-cue-marker small {
          color: #707795;
          font-size: 8px;
          font-weight: 950;
          letter-spacing: .1em;
          text-transform: uppercase;
        }
        .atlas-day-timeline-group .atlas-owner-day-cue-marker strong {
          font-size: 12px;
          line-height: 1.12;
          font-weight: 900;
        }
        .atlas-day-timeline-group .atlas-owner-day-cue-marker > span:not(.atlas-owner-day-cue-node) {
          color: #77798c;
          font-size: 9.5px;
          line-height: 1.2;
        }

        @media (max-width: 390px) {
          .atlas-day-timeline-group .atlas-owner-potential-day-card {
            margin-left: 10px;
          }
          .atlas-day-timeline-group .atlas-owner-potential-day-card::before {
            left: -26px;
            width: 26px;
          }
          .atlas-day-timeline-group .atlas-owner-potential-day-node {
            left: -35px;
          }
        }
      `}</style>
      <span hidden data-owner-day-visual-grammar="committed-white potential-purple cue-interruption" />
    </>
  );
}
