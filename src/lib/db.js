import { supabase } from "./supabase";

const mapPerson = (r) => ({ id: r.id, name: r.name });
const mapPiece = (r) => ({ id: r.id, name: r.name, length: r.length_seconds, type: r.type || "normal", archived: r.archived === true, energy: r.energy || "Medium" });
const mapRole = (r) => ({ id: r.id, name: r.name, pieceId: r.piece_id, required: r.required !== false, trackId: r.track_id || null });
const mapProp = (r) => ({ id: r.id, name: r.name, pieceId: r.piece_id });
const mapAssignment = (r) => ({ id: r.id, personId: r.person_id, roleId: r.role_id });
const mapCastPreset = (r) => ({ id: r.id, name: r.name, personIds: r.person_ids || [] });
const mapSavedShow = (r) => ({ id: r.id, name: r.name, pieceIds: r.piece_ids || [], trackIds: r.track_ids || [] });
const mapTrack = (r) => ({ id: r.id, name: r.name });
const mapTrackAssignment = (r) => ({ id: r.id, trackId: r.track_id, personId: r.person_id });

function check(res) {
  if (res.error) throw res.error;
  return res.data;
}

export async function fetchAll() {
  const [people, pieces, roles, props, assignments, castPresets, savedShows, tracks, trackAssignments] = await Promise.all([
    supabase.from("people").select("*").order("name"),
    supabase.from("pieces").select("*").order("name"),
    supabase.from("roles").select("*"),
    supabase.from("props").select("*"),
    supabase.from("assignments").select("*"),
    supabase.from("cast_presets").select("*").order("name"),
    supabase.from("saved_shows").select("*").order("created_at", { ascending: false }),
    supabase.from("tracks").select("*").order("name"),
    supabase.from("track_assignments").select("*"),
  ]);
  return {
    people: check(people).map(mapPerson),
    pieces: check(pieces).map(mapPiece),
    roles: check(roles).map(mapRole),
    props: check(props).map(mapProp),
    assignments: check(assignments).map(mapAssignment),
    castPresets: check(castPresets).map(mapCastPreset),
    savedShows: check(savedShows).map(mapSavedShow),
    tracks: check(tracks).map(mapTrack),
    trackAssignments: check(trackAssignments).map(mapTrackAssignment),
  };
}

export async function addPerson(name) {
  return mapPerson(check(await supabase.from("people").insert({ name }).select().single()));
}
export async function deletePerson(id) {
  check(await supabase.from("people").delete().eq("id", id));
}

export async function addPiece(name, length, type = "normal", energy = "Medium") {
  return mapPiece(check(await supabase.from("pieces").insert({ name, length_seconds: length, type, energy }).select().single()));
}
export async function updatePiece(id, name, length) {
  return mapPiece(check(await supabase.from("pieces").update({ name, length_seconds: length }).eq("id", id).select().single()));
}
export async function updatePieceType(id, type) {
  return mapPiece(check(await supabase.from("pieces").update({ type }).eq("id", id).select().single()));
}
export async function updatePieceArchived(id, archived) {
  return mapPiece(check(await supabase.from("pieces").update({ archived }).eq("id", id).select().single()));
}
export async function updatePieceEnergy(id, energy) {
  return mapPiece(check(await supabase.from("pieces").update({ energy }).eq("id", id).select().single()));
}
export async function deletePiece(id) {
  check(await supabase.from("pieces").delete().eq("id", id));
}

export async function addRole(name, pieceId, required = true) {
  return mapRole(check(await supabase.from("roles").insert({ name, piece_id: pieceId, required }).select().single()));
}
export async function updateRoleName(id, name) {
  return mapRole(check(await supabase.from("roles").update({ name }).eq("id", id).select().single()));
}
export async function updateRoleRequired(id, required) {
  return mapRole(check(await supabase.from("roles").update({ required }).eq("id", id).select().single()));
}
export async function updateRoleTrack(id, trackId) {
  return mapRole(check(await supabase.from("roles").update({ track_id: trackId }).eq("id", id).select().single()));
}
export async function deleteRole(id) {
  check(await supabase.from("roles").delete().eq("id", id));
}

export async function addProp(name, pieceId) {
  return mapProp(check(await supabase.from("props").insert({ name, piece_id: pieceId }).select().single()));
}
export async function deleteProp(id) {
  check(await supabase.from("props").delete().eq("id", id));
}

export async function addAssignment(personId, roleId) {
  return mapAssignment(check(await supabase.from("assignments").insert({ person_id: personId, role_id: roleId }).select().single()));
}
export async function deleteAssignment(id) {
  check(await supabase.from("assignments").delete().eq("id", id));
}

export async function addCastPreset(name, personIds) {
  return mapCastPreset(check(await supabase.from("cast_presets").insert({ name, person_ids: personIds }).select().single()));
}
export async function deleteCastPreset(id) {
  check(await supabase.from("cast_presets").delete().eq("id", id));
}

export async function addSavedShow(name, pieceIds) {
  return mapSavedShow(check(await supabase.from("saved_shows").insert({ name, piece_ids: pieceIds }).select().single()));
}
export async function updateSavedShowTracks(id, trackIds) {
  return mapSavedShow(check(await supabase.from("saved_shows").update({ track_ids: trackIds }).eq("id", id).select().single()));
}
export async function deleteSavedShow(id) {
  check(await supabase.from("saved_shows").delete().eq("id", id));
}

export async function addTrack(name) {
  return mapTrack(check(await supabase.from("tracks").insert({ name }).select().single()));
}
export async function updateTrackName(id, name) {
  return mapTrack(check(await supabase.from("tracks").update({ name }).eq("id", id).select().single()));
}
export async function deleteTrack(id) {
  check(await supabase.from("tracks").delete().eq("id", id));
}

export async function addTrackAssignment(trackId, personId) {
  return mapTrackAssignment(check(await supabase.from("track_assignments").insert({ track_id: trackId, person_id: personId }).select().single()));
}
export async function deleteTrackAssignment(id) {
  check(await supabase.from("track_assignments").delete().eq("id", id));
}
