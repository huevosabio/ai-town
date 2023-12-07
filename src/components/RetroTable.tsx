import React from 'react';
//import './RetroTable.css';

type RetroTableData = {
  columns: {
    header: string;
    field: string;
  }[];
  rows: {
    [key: string]: string;
  }[];
};

const RetroTable = (data: RetroTableData) => {
  return (
    <table className="retro-table">
      <thead>
        <tr>
          {data.columns.map((column, index) => (
            <th key={index}>{column.header}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {data.rows.map((row, rowIndex) => (
          <tr key={rowIndex}>
            {data.columns.map((column, columnIndex) => (
              <td key={columnIndex}>{row[column.field]}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
};

export default RetroTable;