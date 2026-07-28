# Zone and object universal Trail migration

This build finishes the remaining bounded portion of Build 6 after the universal Day, Week, and Month collections.

- Zone Registry cards show a compact position from a visible object Trail.
- Zone object and room lists show the same compact Trail-position component.
- Object workbenches replace the feature-owned Now/Next/Later renderer with the shared `AtlasTrail` component.
- Real current tasks open through canonical task focus.
- Future operational milestones remain projected, non-playable Trail nodes and never create task rows.
- Existing crop, plant, room, observation, quick-log, and event history records remain the source data.

No database migration is required. The implementation adapts the existing object workbench and operational timeline readers into the universal Trail contract.
