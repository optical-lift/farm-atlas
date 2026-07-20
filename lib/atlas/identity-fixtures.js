export const ATLAS_IDENTITY_FIXTURES = Object.freeze({
  owner: Object.freeze({
    user: Object.freeze({
      id: "fixture-user-owner",
      email: "owner.fixture@atlas.invalid",
      user_metadata: Object.freeze({ display_name: "Owner Fixture" }),
    }),
    profile: Object.freeze({
      user_id: "fixture-user-owner",
      display_name: "Owner Fixture",
      default_farm_id: "fixture-farm-elm",
      active: true,
    }),
    memberships: Object.freeze([
      Object.freeze({
        id: "fixture-membership-owner",
        farm_id: "fixture-farm-elm",
        role: "owner",
        worker_key: "owner-fixture",
        active: true,
        permissions: Object.freeze({ all_farm_data: true, manage_memberships: true }),
        farm: Object.freeze({
          id: "fixture-farm-elm",
          stable_key: "fixture_elm_farm",
          name: "Fixture Elm Farm",
          status: "active",
        }),
      }),
    ]),
  }),
  manager: Object.freeze({
    user: Object.freeze({
      id: "fixture-user-manager",
      email: "manager.fixture@atlas.invalid",
      user_metadata: Object.freeze({ display_name: "Manager Fixture" }),
    }),
    profile: Object.freeze({
      user_id: "fixture-user-manager",
      display_name: "Manager Fixture",
      default_farm_id: "fixture-farm-elm",
      active: true,
    }),
    memberships: Object.freeze([
      Object.freeze({
        id: "fixture-membership-manager",
        farm_id: "fixture-farm-elm",
        role: "manager",
        worker_key: "manager-fixture",
        active: true,
        permissions: Object.freeze({ coordinate_workers: true }),
        farm: Object.freeze({
          id: "fixture-farm-elm",
          stable_key: "fixture_elm_farm",
          name: "Fixture Elm Farm",
          status: "active",
        }),
      }),
    ]),
  }),
  farmHand: Object.freeze({
    user: Object.freeze({
      id: "fixture-user-farm-hand",
      email: "farm-hand.fixture@atlas.invalid",
      user_metadata: Object.freeze({ display_name: "Farm-Hand Fixture" }),
    }),
    profile: Object.freeze({
      user_id: "fixture-user-farm-hand",
      display_name: "Farm-Hand Fixture",
      default_farm_id: "fixture-farm-elm",
      active: true,
    }),
    memberships: Object.freeze([
      Object.freeze({
        id: "fixture-membership-farm-hand",
        farm_id: "fixture-farm-elm",
        role: "farm_hand",
        worker_key: "farm-hand-fixture",
        active: true,
        permissions: Object.freeze({ submit_task_results: true }),
        farm: Object.freeze({
          id: "fixture-farm-elm",
          stable_key: "fixture_elm_farm",
          name: "Fixture Elm Farm",
          status: "active",
        }),
      }),
    ]),
  }),
});
