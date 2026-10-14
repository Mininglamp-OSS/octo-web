import React from "react";
import { X } from "lucide-react";
import { getFileIconByExtension } from "../../Utils/fileIcon";
import type { FileCardProps } from "./types";
import "./index.css";

const FileCard: React.FC<FileCardProps> = ({
  name,
  size,
  extension = "",
  icon,
  actions,
  progress,
  status,
  onRemove,
  removeLabel,
  onClick,
  title,
  active,
  className = "",
}) => {
  const dot = name.lastIndexOf(".");
  const ext = (
    dot > 0 && dot < name.length - 1 ? name.slice(dot + 1) : extension
  ).toUpperCase();
  const percent = Math.min(100, Math.max(0, Math.round(progress || 0)));

  return (
    <div
      className={`wk-file-card${onClick ? " wk-file-card--clickable" : ""}${
        active ? " wk-file-card--active" : ""
      } ${className}`}
      onClick={onClick}
      title={title}
    >
      <div className="wk-file-card-icon">
        {icon || (
          <img src={getFileIconByExtension(ext)} alt="" draggable={false} />
        )}
      </div>
      <div className="wk-file-card-info">
        <div className="wk-file-card-name" title={name}>
          {name}
        </div>
        {progress !== undefined ? (
          <div className="wk-file-card-progress">
            <div
              className="wk-file-card-progress-track"
              role="progressbar"
              aria-label={name}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={percent}
            >
              <div
                className="wk-file-card-progress-fill"
                style={{ width: `${percent}%` }}
              />
            </div>
            <span>{percent}%</span>
          </div>
        ) : (
          <div className="wk-file-card-footer">
            <div className="wk-file-card-meta">
              {status || (
                <>
                  <span className="wk-file-card-size">{size}</span>
                  {ext && (
                    <span className="wk-file-card-ext" title={ext}>
                      {ext}
                    </span>
                  )}
                </>
              )}
            </div>
            {actions && <div className="wk-file-card-actions">{actions}</div>}
          </div>
        )}
      </div>
      {onRemove && (
        <button
          className="wk-file-card-action wk-file-card-remove"
          type="button"
          title={removeLabel}
          aria-label={removeLabel}
          contentEditable={false}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onRemove();
          }}
        >
          <X aria-hidden="true" />
        </button>
      )}
    </div>
  );
};

export default FileCard;
export { FileCard };
