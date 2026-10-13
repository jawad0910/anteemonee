#!/usr/bin/env python3
"""
Textbook RAG (Retrieval-Augmented Generation) Script
=====================================================
Extracts only relevant textbook chunks for a given query using
semantic search with embeddings. Reduces token usage by 80-90%.

Usage:
    python3 textbook_rag.py --query "photosynthesis process" --subject biology
    python3 textbook_rag.py --query "quadratic formula" --subject math --book-id 5
    python3 textbook_rag.py --generate-embeddings --book-id 5  # One-time embed
"""

import os
import sys
import argparse
import json
from typing import List, Optional
from dataclasses import dataclass

try:
    import openai
    import psycopg2
    import numpy as np
    from pgvector.psycopg2 import register_vector
except ImportError as e:
    print(f"Missing dependencies: {e}")
    print("Install: pip install openai psycopg2-binary pgvector numpy")
    sys.exit(1)


@dataclass
class TextbookChunk:
    book_id: int
    book_title: str
    page_number: int
    printed_page_number: int
    chapter_id: int
    chapter_number: int
    chapter_name: str
    full_text: str
    similarity: float


class TextbookRAG:
    def __init__(self, db_url: str, openai_api_key: str, embedding_model: str = "text-embedding-3-small"):
        import psycopg2
        from pgvector.psycopg2 import register_vector
        
        self.conn = psycopg2.connect(db_url)
        register_vector(self.conn)
        
        import openai
        self.openai = openai.OpenAI(api_key=openai_api_key)
        self.embedding_model = "text-embedding-3-small"
        self.embedding_dim = 1536  # text-embedding-3-small = 1536 dims

    def generate_embedding(self, text: str) -> list:
        """Generate embedding for a single text using OpenAI."""
        text = text.replace("\n", " ").strip()
        if len(text) > 8000:  # Truncate if too long
            text = text[:8000]
        response = self.openai.embeddings.create(
            model="text-embedding-3-small",
            input=text
        )
        return response.data[0].embedding

    def generate_embeddings_for_book(self, book_id: int, chunk_size: int = 1000, overlap: int = 200) -> int:
        """Generate embeddings for all pages of a book, chunking long pages."""
        cursor = self.conn.cursor()
        
        # Get all pages for the book
        cursor.execute("""
            SELECT id, text_content 
            FROM public.book_pages 
            WHERE book_id = %s AND text_content IS NOT NULL
            ORDER BY page_number
        """, (book_id,))
        
        pages = cursor.fetchall()
        if not pages:
            print(f"No pages found for book_id {book_id}")
            return 0
        
        updated = 0
        for page_id, text in pages:
            # Split long text into overlapping chunks
            chunks = self._chunk_text(text, chunk_size, overlap)
            
            for i, chunk in enumerate(chunks):
                embedding = self.generate_embedding(chunk)
                
                # Store embedding - first chunk goes to page, rest would need separate table
                if i == 0:
                    with self.conn.cursor() as cur:
                        cur.execute("""
                            UPDATE public.book_pages 
                            SET embedding = %s 
                            WHERE id = %s
                        """, (embedding, page_id))
                
                updated += 1
                if updated % 10 == 0:
                    print(f"  Processed {updated} pages...")
        
        self.conn.commit()
        print(f"Generated embeddings for {updated} pages in book")
        return updated

    def _chunk_text(self, text: str, chunk_size: int = 1000, overlap: int = 200) -> List[str]:
        """Split text into overlapping chunks."""
        if len(text) <= chunk_size:
            return [text]
        
        chunks = []
        start = 0
        while start < len(text):
            end = min(start + chunk_size, len(text))
            # Try to break at sentence boundary
            if end < len(text):
                last_period = text.rfind('.', start, end)
                if last_period > start + chunk_size // 2:
                    end = last_period + 1
            chunks.append(text[start:end].strip())
            start = end - overlap
            if start >= len(text):
                break
        return chunks

    def search(self, query: str, book_id: Optional[int] = None, 
               limit: int = 5, similarity_threshold: float = 0.7) -> List:
        """Search for relevant textbook chunks using semantic similarity."""
        import psycopg2
        from pgvector.psycopg2 import register_vector
        
        query_embedding = self.generate_embedding(query)
        
        with self.conn.cursor() as cur:
            cur.execute("""
                SELECT 
                    bp.book_id,
                    b.title,
                    bp.page_number,
                    bp.printed_page_number,
                    bp.chapter_id,
                    c.number,
                    c.name,
                    bp.text_content,
                    1 - (bp.embedding <=> %s) as similarity
                FROM public.book_pages bp
                JOIN public.books b ON b.id = bp.book_id
                LEFT JOIN public.chapters c ON c.id = bp.chapter_id
                WHERE bp.embedding IS NOT NULL
                  AND (%s IS NULL OR bp.book_id = %s)
                  AND 1 - (bp.embedding <=> %s) >= %s
                ORDER BY bp.embedding <=> %s
                LIMIT %s
            """, (book_id, book_id, query_embedding, 
                  0.7, query_embedding, 5))
            
            results = []
            for row in cur.fetchall():
                from dataclasses import dataclass
                @dataclass
                class TextbookChunk:
                    book_id: int
                    book_title: str
                    page_number: int
                    printed_page_number: int
                    chapter_id: int
                    chapter_number: int
                    chapter_name: str
                    full_text: str
                    similarity: float
                
                results.append(TextbookChunk(
                    book_id=row[0],
                    book_title=row[1],
                    page_number=row[2],
                    printed_page_number=row[3],
                    chapter_id=row[4],
                    chapter_number=row[5],
                    chapter_name=row[6],
                    full_text=row[7],
                    similarity=row[8]
                ))
            return results


def main():
    import argparse
    import os
    import sys
    
    parser = argparse.ArgumentParser(description="Textbook RAG - Semantic search for textbooks")
    parser.add_argument("--query", type=str, help="Search query")
    parser.add_argument("--subject", type=str, help="Subject name (biology, physics, chemistry, math)")
    parser.add_argument("--book-id", type=int, help="Specific book ID to search")
    parser.add_argument("--limit", type=int, default=5, help="Max results to return")
    parser.add_argument("--similarity", type=float, default=0.7, help="Similarity threshold (0-1)")
    parser.add_argument("--generate-embeddings", action="store_true", help="Generate embeddings for a book")
    parser.add_argument("--embed-book-id", type=int, help="Book ID for embedding generation")
    parser.add_argument("--db-url", type=str, help="PostgreSQL connection URL")
    parser.add_argument("--openai-key", type=str, help="OpenAI API key")
    
    args = parser.parse_args()
    
    # Get config from env if not provided
    db_url = os.getenv("DATABASE_URL") or os.getenv("DATABASE_URL")
    openai_key = os.getenv("OPENAI_API_KEY")
    
    if not os.getenv("DATABASE_URL") and not os.getenv("DATABASE_URL"):
        if not args.db_url:
            print("Error: Need DATABASE_URL (args or env)")
            sys.exit(1)
    if not os.getenv("OPENAI_API_KEY"):
        if not args.openai_key:
            print("Error: Need OPENAI_API_KEY (args or env)")
            sys.exit(1)
    
    import os
    db_url = args.db_url or os.getenv("DATABASE_URL")
    openai_key = args.openai_key or os.getenv("OPENAI_API_KEY")
    
    if not db_url or not openai_key:
        print("Error: Need DATABASE_URL and OPENAI_API_KEY")
        sys.exit(1)
    
    from textbook_rag import TextbookRAG
    rag = TextbookRAG(args.db_url or os.getenv("DATABASE_URL"), args.openai_key or os.getenv("OPENAI_API_KEY"))
    
    if args.generate_embeddings:
        if not args.embed_book_id:
            print("Error: --embed-book-id required for --generate-embeddings")
            sys.exit(1)
        print(f"Generating embeddings for book {args.embed_book_id}...")
        rag.generate_embeddings_for_book(args.embed_book_id)
        print("Done!")
        return
    
    if not args.query:
        print("Error: --query required for search")
        sys.exit(1)
    
    # Determine book_id from subject if not provided
    book_id = args.book_id
    if not book_id and args.subject:
        subject_map = {
            "biology": 4, "chemistry": 5, "physics": 6, "math": 7, "mathematics": 7
        }
        book_id = subject_map.get(args.subject.lower())
        if not book_id:
            print(f"Unknown subject: {args.subject}")
            sys.exit(1)
    
    print(f"Searching for: '{args.query}'")
    results = rag.search(args.query, book_id=args.book_id, limit=args.limit, similarity_threshold=args.similarity)
    
    if not results:
        print("No relevant chunks found.")
        return
    
    print(f"\nFound {len(results)} relevant chunks:")
    for i, chunk in enumerate(results, 1):
        print(f"\n--- Result {i} (similarity: {chunk.similarity:.3f}) ---")
        print(f"Book: {chunk.book_title}")
        print(f"Chapter {chunk.chapter_number}: {chunk.chapter_name}")
        print(f"Page {chunk.printed_page_number}")
        print(f"Text: {chunk.full_text[:500]}...")
        if len(chunk.full_text) > 500:
            print(f"      [... truncated, {len(chunk.full_text)} chars total]")
    
    # Output JSON for AI consumption
    output = {
        "chunks": [
            {
                "book_title": c.book_title,
                "chapter": f"Ch {c.chapter_number}: {c.chapter_name}",
                "page": c.printed_page_number,
                "text": c.full_text,
                "similarity": round(c.similarity, 4)
            }
            for c in results
        ]
    }
    print("\n--- JSON OUTPUT ---")
    print(json.dumps(output, indent=2))


if __name__ == "__main__":
    main()