-- V23: visitors may see ONLY the selected cover image of any album.
-- The rest of password/link album photos remain protected.

drop policy if exists "Visitors can read album covers" on storage.objects;

create policy "Visitors can read album covers"
on storage.objects
for select
to anon
using (
  bucket_id = 'photos'
  and exists (
    select 1
    from public.albums
    where albums.cover_url = storage.objects.name
  )
);
