const express = require('express');
const sanitizeHtml = require('sanitize-html');
const fs = require('fs');
const path = require('path');

// 💡 sanitize-html 옵션: XSS 방지 및 기본 서식 + 이미지, 비디오 허용
const sanitizeOptions = {
  allowedTags: sanitizeHtml.defaults.allowedTags.concat([
    'img', 'video', 'source', 'iframe', 'u', 's', 'span', 
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'br', 'strong', 'em'
  ]),
  allowedAttributes: {
    '*': ['class', 'style', 'data-*'],
    'a': ['href', 'name', 'target'],
    'img': ['src', 'alt', 'width', 'height'],
    'iframe': ['src', 'width', 'height', 'frameborder', 'allow', 'allowfullscreen'],
    'video': ['src', 'width', 'height', 'controls', 'autoplay', 'loop', 'muted'],
    'source': ['src', 'type'],
    'span': ['style', 'class']
  },
  allowedSchemes: ['http', 'https', 'ftp', 'mailto', 'data']
};

module.exports = function(pool, upload) {
  const router = express.Router();

  // 로그인 및 권한 체크 미들웨어 / 유틸
  const requireLogin = (req, res, next) => {
    if (!req.session?.user) {
      return res.status(401).json({ success: false, message: '로그인이 필요합니다.' });
    }
    next();
  };

  const hasManagerPermission = (user) => {
    const isAdmin = Array.isArray(user.roles) && user.roles.some(r => r.role_name === '관리자');
    const isFinance = user.deptName === '재정부';
    return isAdmin || isFinance;
  };

  const canEditOrDelete = (req, authorId) => {
    const user = req.session?.user;
    if (!user) return false;
    if (String(user.userId) === String(authorId)) return true;
    return hasManagerPermission(user);
  };

  // 1. 게시판 목록 조회 (페이지네이션)
  router.get('/', requireLogin, async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;

    try {
      const [countResult] = await pool.query(`SELECT COUNT(*) as total FROM boards`);
      const total = countResult[0].total;
      const totalPages = Math.ceil(total / limit);

      const [rows] = await pool.query(`
        SELECT id, title, author_id, author_name, view_count, created_at
        FROM boards
        ORDER BY id DESC
        LIMIT ? OFFSET ?
      `, [limit, offset]);
      
      // 최신 댓글 개수 (선택적으로 추가 가능)
      const [commentCounts] = await pool.query(`
        SELECT board_id, COUNT(*) as comment_count 
        FROM board_comments 
        WHERE board_id IN (?) 
        GROUP BY board_id
      `, [rows.map(r => r.id).length ? rows.map(r => r.id) : [0]]);
      
      const countMap = {};
      commentCounts.forEach(c => countMap[c.board_id] = c.comment_count);
      
      const enrichedRows = rows.map(row => ({
        ...row,
        comment_count: countMap[row.id] || 0
      }));

      res.json({ success: true, data: enrichedRows, total, page, totalPages });
    } catch (err) {
      console.error(err);
      res.status(500).json({ success: false, message: '게시글 목록 조회 실패' });
    }
  });

  // 2. 게시글 상세 조회
  router.get('/:id', requireLogin, async (req, res) => {
    const boardId = req.params.id;

    try {
      // 조회수 증가
      await pool.query(`UPDATE boards SET view_count = view_count + 1 WHERE id = ?`, [boardId]);

      const [boardRows] = await pool.query(`
        SELECT id, title, content, author_id, author_name, view_count, created_at, updated_at
        FROM boards WHERE id = ?
      `, [boardId]);

      if (boardRows.length === 0) {
        return res.status(404).json({ success: false, message: '게시글이 존재하지 않습니다.' });
      }

      const boardData = boardRows[0];

      // 첨부파일 목록 조회
      const [fileRows] = await pool.query(`
        SELECT id, original_name, file_name, file_size
        FROM board_files WHERE board_id = ?
      `, [boardId]);
      boardData.files = fileRows;

      // 댓글 목록 조회 (간단히 같이 넘김)
      const [commentRows] = await pool.query(`
        SELECT id, parent_id, author_id, author_name, content, created_at, updated_at
        FROM board_comments WHERE board_id = ? ORDER BY id ASC
      `, [boardId]);
      boardData.comments = commentRows;

      res.json({ success: true, data: boardData });
    } catch (err) {
      console.error(err);
      res.status(500).json({ success: false, message: '게시글 상세 조회 실패' });
    }
  });

  // 3. 게시글 작성
  router.post('/', requireLogin, upload.array('files', 10), async (req, res) => {
    const { title, content } = req.body;
    const user = req.session.user;

    if (!title || !content) {
      return res.status(400).json({ success: false, message: '제목과 내용을 비울 수 없습니다.' });
    }

    const cleanContent = sanitizeHtml(content, sanitizeOptions);
    const conn = await pool.getConnection();

    try {
      await conn.beginTransaction();
      const [result] = await conn.query(`
        INSERT INTO boards (title, content, author_id, author_name)
        VALUES (?, ?, ?, ?)
      `, [title, cleanContent, user.userId, user.userName]);

      const boardId = result.insertId;

      if (req.files && req.files.length > 0) {
        const fileValues = req.files.map(f => [
          boardId,
          f.originalname,
          f.filename,
          f.path,
          f.size
        ]);
        await conn.query(`
          INSERT INTO board_files (board_id, original_name, file_name, file_path, file_size)
          VALUES ?
        `, [fileValues]);
      }

      await conn.commit();
      res.json({ success: true, message: '게시글이 등록되었습니다.', boardId });
    } catch (err) {
      await conn.rollback();
      console.error('Board insert error:', err);
      res.status(500).json({ success: false, message: '게시글 등록 실패' });
    } finally {
      conn.release();
    }
  });

  // 4. 게시글 수정
  router.put('/:id', requireLogin, upload.array('files', 10), async (req, res) => {
    const boardId = req.params.id;
    const { title, content, deletedFileIds } = req.body;
    
    try {
      const [rows] = await pool.query(`SELECT author_id FROM boards WHERE id = ?`, [boardId]);
      if (rows.length === 0) return res.status(404).json({ success: false, message: '게시글 없음' });
      
      if (!canEditOrDelete(req, rows[0].author_id)) {
        return res.status(403).json({ success: false, message: '권한이 없습니다.' });
      }

      const cleanContent = sanitizeHtml(content, sanitizeOptions);
      const conn = await pool.getConnection();

      try {
        await conn.beginTransaction();
        await conn.query(`
          UPDATE boards SET title = ?, content = ? WHERE id = ?
        `, [title, cleanContent, boardId]);

        // 파일 삭제 처리
        if (deletedFileIds) {
          const ids = JSON.parse(deletedFileIds);
          if (ids.length > 0) {
            const [delFiles] = await conn.query(`SELECT file_path FROM board_files WHERE id IN (?) AND board_id = ?`, [ids, boardId]);
            delFiles.forEach(f => {
              if (fs.existsSync(f.file_path)) fs.unlinkSync(f.file_path);
            });
            await conn.query(`DELETE FROM board_files WHERE id IN (?)`, [ids]);
          }
        }

        // 새 파일 추가
        if (req.files && req.files.length > 0) {
          const fileValues = req.files.map(f => [
            boardId,
            f.originalname,
            f.filename,
            f.path,
            f.size
          ]);
          await conn.query(`
            INSERT INTO board_files (board_id, original_name, file_name, file_path, file_size)
            VALUES ?
          `, [fileValues]);
        }

        await conn.commit();
        res.json({ success: true, message: '게시글이 수정되었습니다.' });
      } catch (err) {
        await conn.rollback();
        throw err;
      } finally {
        conn.release();
      }
    } catch (err) {
      console.error(err);
      res.status(500).json({ success: false, message: '게시글 수정 실패' });
    }
  });

  // 5. 게시글 삭제
  router.delete('/:id', requireLogin, async (req, res) => {
    const boardId = req.params.id;

    try {
      const [rows] = await pool.query(`SELECT author_id FROM boards WHERE id = ?`, [boardId]);
      if (rows.length === 0) return res.status(404).json({ success: false, message: '게시글 없음' });
      
      if (!canEditOrDelete(req, rows[0].author_id)) {
        return res.status(403).json({ success: false, message: '권한이 없습니다.' });
      }

      // 첨부파일 삭제
      const [files] = await pool.query(`SELECT file_path FROM board_files WHERE board_id = ?`, [boardId]);
      files.forEach(f => {
        if (fs.existsSync(f.file_path)) fs.unlinkSync(f.file_path);
      });

      // DB(ON DELETE CASCADE로 댓글, 첨부파일도 자동 삭제됨)
      await pool.query(`DELETE FROM boards WHERE id = ?`, [boardId]);
      
      res.json({ success: true, message: '게시글이 삭제되었습니다.' });
    } catch (err) {
      console.error(err);
      res.status(500).json({ success: false, message: '게시글 삭제 실패' });
    }
  });

  // 6. 댓글 작성
  router.post('/:id/comments', requireLogin, async (req, res) => {
    const boardId = req.params.id;
    const { content, parent_id } = req.body;
    const user = req.session.user;

    if (!content || !content.trim()) {
      return res.status(400).json({ success: false, message: '댓글 내용을 입력하세요.' });
    }
    const cleanContent = sanitizeHtml(content, { allowedTags: [] }); // 댓글은 단순 텍스트로 보존

    try {
      const [result] = await pool.query(`
        INSERT INTO board_comments (board_id, parent_id, author_id, author_name, content)
        VALUES (?, ?, ?, ?, ?)
      `, [boardId, parent_id || null, user.userId, user.userName, cleanContent]);
      
      res.json({ success: true, message: '댓글이 등록되었습니다.', commentId: result.insertId });
    } catch (err) {
      console.error(err);
      res.status(500).json({ success: false, message: '댓글 등록 실패' });
    }
  });

  // 7. 댓글 삭제
  router.delete('/comments/:commentId', requireLogin, async (req, res) => {
    const commentId = req.params.commentId;

    try {
      const [rows] = await pool.query(`SELECT author_id FROM board_comments WHERE id = ?`, [commentId]);
      if (rows.length === 0) return res.status(404).json({ success: false, message: '댓글 없음' });
      
      if (!canEditOrDelete(req, rows[0].author_id)) {
        return res.status(403).json({ success: false, message: '권한이 없습니다.' });
      }

      await pool.query(`DELETE FROM board_comments WHERE id = ?`, [commentId]);
      res.json({ success: true, message: '댓글이 삭제되었습니다.' });
    } catch (err) {
      console.error(err);
      res.status(500).json({ success: false, message: '댓글 삭제 실패' });
    }
  });

  return router;
};
