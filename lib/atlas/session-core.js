const FARM_ROLE_ORDER = {
  owner: 0,
  manager: 1,
  farm_hand: 2,
};

const ORGANIZATION_ROLE_ORDER = {
  owner: 0,
  consultant: 1,
  member: 2,
};

function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function asText(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function relatedRow(value) {
  if (Array.isArray(value)) return asRecord(value[0]);
  return asRecord(value);
}

function permissionsRow(value) {
  return asRecord(value);
}

export function normalizeAtlasSession({ user, profile, memberships, organizationMemberships }) {
  const userRow = asRecord(user);
  const profileRow = asRecord(profile);
  const userId = asText(userRow.id);

  if (!userId) return null;

  const normalizedMemberships = (Array.isArray(memberships) ? memberships : [])
    .map((value) => {
      const membership = asRecord(value);
      const farm = relatedRow(membership.farm);
      const role = asText(membership.role);
      const membershipId = asText(membership.id);
      const farmId = asText(membership.farm_id);

      if (
        !membershipId ||
        !farmId ||
        !role ||
        !(role in FARM_ROLE_ORDER) ||
        membership.active === false
      ) {
        return null;
      }

      return {
        membershipId,
        farmId,
        farmKey: asText(farm.stable_key),
        farmName: asText(farm.name),
        farmStatus: asText(farm.status),
        role,
        workerKey: asText(membership.worker_key),
        permissions: permissionsRow(membership.permissions),
      };
    })
    .filter(Boolean)
    .sort((left, right) => {
      const roleDifference = FARM_ROLE_ORDER[left.role] - FARM_ROLE_ORDER[right.role];
      if (roleDifference) return roleDifference;
      return (left.farmName ?? left.farmKey ?? "").localeCompare(
        right.farmName ?? right.farmKey ?? "",
      );
    });

  const normalizedOrganizationMemberships = (
    Array.isArray(organizationMemberships) ? organizationMemberships : []
  )
    .map((value) => {
      const membership = asRecord(value);
      const organization = relatedRow(membership.organization);
      const role = asText(membership.role);
      const membershipId = asText(membership.id);
      const organizationId = asText(membership.organization_id);

      if (
        !membershipId ||
        !organizationId ||
        !role ||
        !(role in ORGANIZATION_ROLE_ORDER) ||
        membership.active === false
      ) {
        return null;
      }

      return {
        membershipId,
        organizationId,
        organizationKey: asText(organization.stable_key),
        organizationName: asText(organization.name),
        organizationStatus: asText(organization.status),
        role,
        permissions: permissionsRow(membership.permissions),
      };
    })
    .filter(Boolean)
    .sort((left, right) => {
      const roleDifference =
        ORGANIZATION_ROLE_ORDER[left.role] - ORGANIZATION_ROLE_ORDER[right.role];
      if (roleDifference) return roleDifference;
      return (left.organizationName ?? left.organizationKey ?? "").localeCompare(
        right.organizationName ?? right.organizationKey ?? "",
      );
    });

  const requestedDefaultFarmId = asText(profileRow.default_farm_id);
  const activeFarmId = normalizedMemberships.some(
    (membership) => membership.farmId === requestedDefaultFarmId,
  )
    ? requestedDefaultFarmId
    : normalizedMemberships[0]?.farmId ?? null;

  const activeOrganizationId = normalizedOrganizationMemberships[0]?.organizationId ?? null;
  const email = asText(userRow.email);
  const displayName =
    asText(profileRow.display_name) ??
    asText(asRecord(userRow.user_metadata).display_name) ??
    email ??
    "Atlas user";

  return {
    userId,
    email,
    displayName,
    activeFarmId,
    activeOrganizationId,
    memberships: normalizedMemberships,
    organizationMemberships: normalizedOrganizationMemberships,
  };
}
