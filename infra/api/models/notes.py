from pydantic import BaseModel


class NoteDocument(BaseModel):
    id: int
    file_path: str
    title: str
    category: str | None = None
    description: str | None = None
    last_modified: str | None = None
    git_commit_sha: str | None = None
    tags: list[str] = []


class NoteDocumentWithContent(NoteDocument):
    content: str | None = None


class NotesListResponse(BaseModel):
    documents: list[NoteDocument]
    total: int
    limit: int
    offset: int
    has_more: bool


class NotesByCategoryResponse(BaseModel):
    category: str
    documents: list[NoteDocument]
    total: int
    limit: int
    offset: int
    has_more: bool


class NotesByTagResponse(BaseModel):
    tag: str
    documents: list[NoteDocument]
    total: int
    limit: int
    offset: int
    has_more: bool


class Tag(BaseModel):
    id: int
    name: str
    document_count: int


class TagsResponse(BaseModel):
    tags: list[Tag]


class Category(BaseModel):
    id: int
    name: str
    document_count: int


class CategoriesResponse(BaseModel):
    categories: list[Category]


class SingleNoteResponse(BaseModel):
    document: NoteDocumentWithContent


class SyncJob(BaseModel):
    id: int
    status: str
    commit_sha: str | None = None
    total_items: int
    completed_items: int
    failed_items: int
    created_at: str | None = None
    completed_at: str | None = None


class SyncJobDetail(SyncJob):
    started_at: str | None = None
    error_message: str | None = None
    rate_limit_reset_at: str | None = None
    last_activity_at: str | None = None


class SyncJobsListResponse(BaseModel):
    jobs: list[SyncJob]


class FailedItem(BaseModel):
    id: int
    file_path: str
    retry_count: int
    last_error: str | None = None


class SyncJobDetailResponse(BaseModel):
    job: SyncJobDetail
    failed_items: list[FailedItem]
