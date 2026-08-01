# Object-first maintenance directives

A maintenance directive is temporary work attached to a persistent Weed Card or governed Mowing Card.

It is not a second maintenance identity.

## Instruction

An instruction brings the persistent card into Work on a chosen farm day and lockscreen window. The instruction remains visible on the card until a real Weed Card session or Mowing result satisfies its effect policy.

Effect policies:

- `bring_forward_only`: any real result closes the instruction; the underlying maintenance result retains its normal meaning.
- `inspection_only`: an observation closes the instruction without claiming maintenance happened.
- `target_condition`: a Weed Card instruction remains active until the recorded physical condition reaches the selected target.
- `full_maintenance`: requires `clear` for Weed Cards or `mowed_full` for Mowing Cards.

## Prerequisite

A prerequisite is a separate ordinary task because it has its own completion truth. The existing maintenance card is blocked by that task and reopens when the prerequisite is completed.

## Crop and place context

The directive belongs to one canonical growing object. Selected crop cycles are written to both the directive relationship and the task crop-cycle relationship. Checklist steps remain inside the temporary directive and do not become competing Work tasks.

## Notifications

Creating a directive writes the existing task notification plan for the chosen work window. It does not create Bell or Journal history merely because the card was brought forward.

## Roles

Owners and managers may author or cancel directives. The assigned player, a manager, or an owner may update its checklist. Maintenance results remain governed by the existing Weed and Mowing result interfaces.
