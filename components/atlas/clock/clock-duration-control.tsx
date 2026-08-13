"use client";

export default function ClockDurationControl(props: {
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
  onSave: () => void;
  onRemove?: () => void;
}) {
  return (
    <div data-clock-owner-duration-controls="true">
      <input type="number" min="5" max="720" step="5" value={props.value} onChange={(event) => props.onChange(event.target.value)} />
      <button type="button" disabled={props.disabled} onClick={props.onSave}>Save span</button>
      {props.onRemove ? <button type="button" disabled={props.disabled} onClick={props.onRemove}>Remove span</button> : null}
    </div>
  );
}
