const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY / SUPABASE_ANON_KEY');
  process.exit(1);
}

const supabaseClient = createClient(SUPABASE_URL, SUPABASE_KEY);

const FILE_TO_SLUG = {
  'community-events-2026.json': 'community-events',
  'fall-fest-2026.json': 'fall-fest',
  'second-fridays-2026.json': 'second-fridays',
  'high-school-events-2026.json': 'high-school-events',
  'town-services-2026.json': 'town-services',
  'christmas-on-vinegar-hill-2026.json': 'christmas-on-vinegar-hill'
};

function readJson(filePath) {
  const fullPath = path.resolve(filePath);
  if (!fs.existsSync(fullPath)) {
    throw new Error(`File not found: ${fullPath}`);
  }

  const raw = fs.readFileSync(fullPath, 'utf8');
  return {
    fullPath,
    json: JSON.parse(raw)
  };
}

async function ensureGroupExists(groupSlug) {
  const { data, error } = await supabaseClient
    .from('groups')
    .select('slug')
    .eq('slug', groupSlug)
    .maybeSingle();

  if (error) {
    throw new Error(`Unable to verify group "${groupSlug}": ${error.message}`);
  }

  if (!data) {
    throw new Error(`Group "${groupSlug}" does not exist. Seed groups first in SQL.`);
  }
}

async function upsertEventPage(pageSlug, raw) {
  const payload = {
    slug: pageSlug,
    group_slug: pageSlug,
    event_name: raw.eventName || pageSlug,
    event_type: raw.eventType || null,
    summary: raw.summary || null,
    date_label: raw.dateLabel || null,
    area_label: raw.areaLabel || null,
    category: raw.category || null,
    tabs: Array.isArray(raw.tabs) ? raw.tabs : [],
    dates: Array.isArray(raw.dates) ? raw.dates : [],
    theme: raw.theme || null,
    featured_branding: raw.featuredBranding || null,
    flyer: raw.flyer || null,
    resources: Array.isArray(raw.resources) ? raw.resources : [],
    raw
  };

  const { error } = await supabaseClient
    .from('event_pages')
    .upsert(payload, { onConflict: 'slug' });

  if (error) {
    throw new Error(`event_pages upsert failed for "${pageSlug}": ${error.message}`);
  }
}

async function replaceChildRows(pageSlug, raw) {
  const { error: deleteVendorsError } = await supabaseClient
    .from('event_vendors')
    .delete()
    .eq('page_slug', pageSlug);
  if (deleteVendorsError) {
    throw new Error(`event_vendors delete failed for "${pageSlug}": ${deleteVendorsError.message}`);
  }

  const { error: deleteScheduleError } = await supabaseClient
    .from('event_schedule')
    .delete()
    .eq('page_slug', pageSlug);
  if (deleteScheduleError) {
    throw new Error(`event_schedule delete failed for "${pageSlug}": ${deleteScheduleError.message}`);
  }

  const { error: deleteLocationsError } = await supabaseClient
    .from('event_locations')
    .delete()
    .eq('page_slug', pageSlug);
  if (deleteLocationsError) {
    throw new Error(`event_locations delete failed for "${pageSlug}": ${deleteLocationsError.message}`);
  }

  const { error: deleteDaysError } = await supabaseClient
    .from('event_days')
    .delete()
    .eq('page_slug', pageSlug);
  if (deleteDaysError) {
    throw new Error(`event_days delete failed for "${pageSlug}": ${deleteDaysError.message}`);
  }

  const dayRows = (raw.days || []).map((day, index) => ({
    page_slug: pageSlug,
    external_id: day.id,
    label: day.label || `Day ${index + 1}`,
    event_date: day.date,
    sort_order: index,
    raw: day
  }));

  if (dayRows.length) {
    const { error } = await supabaseClient.from('event_days').insert(dayRows);
    if (error) {
      throw new Error(`event_days insert failed for "${pageSlug}": ${error.message}`);
    }
  }

  const locationRows = (raw.locations || []).map((loc, index) => ({
    page_slug: pageSlug,
    external_id: loc.id,
    name: loc.name || 'Unnamed Location',
    address: loc.address || null,
    map_x: loc.mapX ?? null,
    map_y: loc.mapY ?? null,
    description: loc.description || null,
    notes: loc.notes || null,
    directions_text: loc.directionsText || null,
    pin_icon: loc.pinIcon || null,
    hours: loc.hours || null,
    tags: Array.isArray(loc.tags) ? loc.tags : [],
    multi_vendor: !!loc.multiVendor,
    location_group: loc.group || null,
    sort_order: index,
    raw: loc
  }));

  if (locationRows.length) {
    const { error } = await supabaseClient.from('event_locations').insert(locationRows);
    if (error) {
      throw new Error(`event_locations insert failed for "${pageSlug}": ${error.message}`);
    }
  }

  const scheduleRows = (raw.schedule || []).map((item, index) => ({
    page_slug: pageSlug,
    external_id: item.id,
    day_external_id: item.dayId || null,
    title: item.title || 'Untitled Event',
    start_time: item.startTime || null,
    end_time: item.endTime || null,
    location_external_id: item.locationId || null,
    category: item.category || null,
    description: item.description || null,
    vendor_ids: Array.isArray(item.vendorIds) ? item.vendorIds : [],
    event_date: item.date || null,
    sort_order: index,
    raw: item
  }));

  if (scheduleRows.length) {
    const { error } = await supabaseClient.from('event_schedule').insert(scheduleRows);
    if (error) {
      throw new Error(`event_schedule insert failed for "${pageSlug}": ${error.message}`);
    }
  }

  const vendorRows = (raw.vendors || []).map((vendor) => ({
    page_slug: pageSlug,
    external_id: vendor.id,
    name: vendor.name || 'Unnamed Vendor',
    location_external_id: vendor.locationId || null,
    category: vendor.category || null,
    description: vendor.description || null,
    booth: vendor.booth || null,
    hours: vendor.hours || null,
    raw: vendor
  }));

  if (vendorRows.length) {
    const { error } = await supabaseClient.from('event_vendors').insert(vendorRows);
    if (error) {
      throw new Error(`event_vendors insert failed for "${pageSlug}": ${error.message}`);
    }
  }

  return {
    days: dayRows.length,
    locations: locationRows.length,
    schedule: scheduleRows.length,
    vendors: vendorRows.length
  };
}

async function replaceFlyerRows(pageSlug, raw) {
  const flyer = raw.flyer || {};

  const { data: existingSections, error: existingSectionsError } = await supabaseClient
    .from('event_flyer_sections')
    .select('id')
    .eq('page_slug', pageSlug);

  if (existingSectionsError) {
    throw new Error(`event_flyer_sections read failed for "${pageSlug}": ${existingSectionsError.message}`);
  }

  const sectionIds = (existingSections || []).map(x => x.id);

  if (sectionIds.length) {
    const { error: deleteEntriesError } = await supabaseClient
      .from('event_flyer_entries')
      .delete()
      .in('section_id', sectionIds);

    if (deleteEntriesError) {
      throw new Error(`event_flyer_entries delete failed for "${pageSlug}": ${deleteEntriesError.message}`);
    }
  }

  const { error: deleteSectionsError } = await supabaseClient
    .from('event_flyer_sections')
    .delete()
    .eq('page_slug', pageSlug);

  if (deleteSectionsError) {
    throw new Error(`event_flyer_sections delete failed for "${pageSlug}": ${deleteSectionsError.message}`);
  }

  const { error: deleteLegendError } = await supabaseClient
    .from('event_flyer_legend')
    .delete()
    .eq('page_slug', pageSlug);

  if (deleteLegendError) {
    throw new Error(`event_flyer_legend delete failed for "${pageSlug}": ${deleteLegendError.message}`);
  }

  const { error: deleteNotesError } = await supabaseClient
    .from('event_flyer_footer_notes')
    .delete()
    .eq('page_slug', pageSlug);

  if (deleteNotesError) {
    throw new Error(`event_flyer_footer_notes delete failed for "${pageSlug}": ${deleteNotesError.message}`);
  }

  const { error: deleteSponsorsError } = await supabaseClient
    .from('event_flyer_sponsors')
    .delete()
    .eq('page_slug', pageSlug);

  if (deleteSponsorsError) {
    throw new Error(`event_flyer_sponsors delete failed for "${pageSlug}": ${deleteSponsorsError.message}`);
  }

  const legendRows = (flyer.iconLegend || []).map((item, index) => ({
    page_slug: pageSlug,
    label: item.label || '',
    meaning: item.meaning || '',
    sort_order: index
  }));

  if (legendRows.length) {
    const { error } = await supabaseClient.from('event_flyer_legend').insert(legendRows);
    if (error) {
      throw new Error(`event_flyer_legend insert failed for "${pageSlug}": ${error.message}`);
    }
  }

  let entryCount = 0;
  let sectionCount = 0;

  for (let i = 0; i < (flyer.sections || []).length; i++) {
    const section = flyer.sections[i];

    const { data: insertedSection, error: sectionError } = await supabaseClient
      .from('event_flyer_sections')
      .insert({
        page_slug: pageSlug,
        title: section.title || `Section ${i + 1}`,
        sort_order: i
      })
      .select('id')
      .single();

    if (sectionError) {
      throw new Error(`event_flyer_sections insert failed for "${pageSlug}": ${sectionError.message}`);
    }

    sectionCount++;

    const entryRows = (section.entries || []).map((entry, index) => ({
      section_id: insertedSection.id,
      entry_code: entry.number || null,
      name: entry.name || '',
      address: entry.address || null,
      hours: entry.hours || null,
      description: entry.description || null,
      badges: Array.isArray(entry.badges) ? entry.badges : [],
      sort_order: index
    }));

    if (entryRows.length) {
      const { error: entryError } = await supabaseClient
        .from('event_flyer_entries')
        .insert(entryRows);

      if (entryError) {
        throw new Error(`event_flyer_entries insert failed for "${pageSlug}": ${entryError.message}`);
      }

      entryCount += entryRows.length;
    }
  }

  const noteRows = (flyer.footerNotes || []).map((note, index) => ({
    page_slug: pageSlug,
    note,
    sort_order: index
  }));

  if (noteRows.length) {
    const { error } = await supabaseClient
      .from('event_flyer_footer_notes')
      .insert(noteRows);

    if (error) {
      throw new Error(`event_flyer_footer_notes insert failed for "${pageSlug}": ${error.message}`);
    }
  }

  const sponsorRows = (flyer.sponsors || []).map((sponsor, index) => ({
    page_slug: pageSlug,
    sponsor_name: sponsor,
    sort_order: index
  }));

  if (sponsorRows.length) {
    const { error } = await supabaseClient
      .from('event_flyer_sponsors')
      .insert(sponsorRows);

    if (error) {
      throw new Error(`event_flyer_sponsors insert failed for "${pageSlug}": ${error.message}`);
    }
  }

  return {
    legend: legendRows.length,
    sections: sectionCount,
    entries: entryCount,
    notes: noteRows.length,
    sponsors: sponsorRows.length
  };
}

async function importOne(filePath, pageSlug) {
  const { fullPath, json: raw } = readJson(filePath);

  console.log(`\nImporting ${pageSlug}`);
  console.log(`Reading: ${fullPath}`);

  await ensureGroupExists(pageSlug);
  await upsertEventPage(pageSlug, raw);

  const counts = await replaceChildRows(pageSlug, raw);
  console.log(`Imported core data for ${pageSlug}`);
  console.log(`  days: ${counts.days}`);
  console.log(`  locations: ${counts.locations}`);
  console.log(`  schedule: ${counts.schedule}`);
  console.log(`  vendors: ${counts.vendors}`);

  const flyerCounts = await replaceFlyerRows(pageSlug, raw);
  console.log(`Imported flyer data for ${pageSlug}`);
  console.log(`  flyer legend: ${flyerCounts.legend}`);
  console.log(`  flyer sections: ${flyerCounts.sections}`);
  console.log(`  flyer entries: ${flyerCounts.entries}`);
  console.log(`  flyer notes: ${flyerCounts.notes}`);
  console.log(`  flyer sponsors: ${flyerCounts.sponsors}`);
}

async function importAll() {
  const baseDir = path.resolve('./data');

  for (const [fileName, pageSlug] of Object.entries(FILE_TO_SLUG)) {
    const fullPath = path.join(baseDir, fileName);
    await importOne(fullPath, pageSlug);
  }
}

async function main() {
  const fileArg = process.argv[2];
  const slugArg = process.argv[3];

  if (fileArg && slugArg) {
    await importOne(fileArg, slugArg);
    return;
  }

  await importAll();
}

main()
  .then(() => {
    console.log('\nImport complete.');
    process.exit(0);
  })
  .catch((err) => {
    console.error('\nImport failed.');
    console.error(err.message || err);
    process.exit(1);
  });