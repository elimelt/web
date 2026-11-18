struct FileRecord {
  1: required string name
  2: required string version
  3: required string filename
  4: required string packagetype
  5: required string python_version
  6: optional string requires_python
  7: required i64 size
  8: required i64 upload_time
  9: required bool yanked
  10: required binary sha256
}
