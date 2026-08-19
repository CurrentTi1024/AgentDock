// Adapted from: src/routes/(main)/community/(list)/features/Pagination (LobeHub canary)
import { Pagination as AntdPagination } from 'antd';
import { createStaticStyles } from 'antd-style';
import { memo } from 'react';

const styles = createStaticStyles(({ css, cssVar }) => ({
  page: css`
    .ant-pagination-item-active {
      border-color: ${cssVar.colorFillSecondary};
      background: ${cssVar.colorFillSecondary};

      &:hover {
        border-color: ${cssVar.colorFill};
        background: ${cssVar.colorFill};
      }
    }
  `,
}));

interface PaginationProps {
  currentPage: number;
  onPageChange: (page: number) => void;
  pageSize: number;
  totalCount: number;
}

const Pagination = memo<PaginationProps>(({ currentPage, onPageChange, pageSize, totalCount }) => (
  <AntdPagination
    className={styles.page}
    current={currentPage}
    data-testid="pagination"
    pageSize={pageSize}
    showSizeChanger={false}
    style={{ alignSelf: 'flex-end' }}
    total={totalCount}
    onChange={onPageChange}
  />
));

Pagination.displayName = 'Pagination';

export default Pagination;
