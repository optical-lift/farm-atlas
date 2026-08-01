# Safety invariants

- A manual weed instruction resolves to one object-owned Weed Card.
- A manual mowing instruction resolves to one object-owned mowing rhythm state.
- Creating an instruction never inserts a weed or mowing result.
- Checklist completion never renews a maintenance rhythm.
- Only Weed Card sessions and mowing events can satisfy instruction result policies.
- Crop links are accepted only when the crop cycle belongs to the same farm and object.
- Ordinary directive release does not write Bell or Journal history.
- Owners and managers author; the assigned player can update their own checklist.
